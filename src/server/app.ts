import express from "express";
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  randomInt,
} from "node:crypto";
import { dirname, join, resolve as resolvePath } from "node:path";
import { z } from "zod";
import {
  activities,
  participants,
  participantIds,
  type ParticipantId,
} from "../domain/catalog";
import {
  tick,
  vote,
  complete,
  skip,
  publicState,
  current,
  publicVoting,
  date,
  type Random,
} from "../domain/engine";
import { Storage } from "./storage";
import { Sessions, SESSION_LIFETIME } from "./sessions";
export type Config = {
  passwords: Record<ParticipantId, string>;
  secret: string;
  dataPath: string;
  secure: boolean;
  trustedProxy?: string;
  now?: () => string;
  random?: Random;
};
export function createApp(config: Config, storage: Storage) {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustedProxy) app.set("trust proxy", config.trustedProxy);
  const now = config.now || (() => new Date().toISOString());
  const random =
    config.random || (() => randomInt(0, 0x100000000) / 0x100000000);
  const sessions = new Sessions(
    join(dirname(config.dataPath), "sessions.json"),
  );
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: config.secure,
    path: "/",
  };
  const credentials = (p: ParticipantId) =>
    createHmac("sha256", config.secret)
      .update(`${p}:${config.passwords[p]}`)
      .digest("hex");
  const attempts = new Map<string, { count: number; until: number }>();
  const signature = (id: string) =>
    createHmac("sha256", config.secret).update(id).digest("hex");
  const participant = async (req: express.Request) => {
    const cookie = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("session="))
      ?.slice(8);
    if (!cookie) return;
    if (!/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(cookie)) return;
    const [id, sig] = cookie.split(".");
    if (
      !id ||
      !sig ||
      !/^[a-f0-9]{64}$/.test(sig) ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(signature(id)))
    )
      return;
    const session = await sessions.get(id);
    if (session && session.credentials === credentials(session.participant))
      return { ...session, id };
  };
  app.use(express.json({ limit: "16kb" }));
  app.use((_req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "same-origin");
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
    );
    next();
  });
  app.get("/health", async (_req, res, next) => {
    try {
      await storage.transaction(() => null);
      await sessions.check();
      res.json({ status: "ok" });
    } catch (e) {
      next(e);
    }
  });
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      if (
        !origin ||
        origin !== `${config.secure ? "https" : "http"}://${req.get("host")}`
      ) {
        res.status(403).json({ error: "Недопустимый источник запроса" });
        return;
      }
    }
    next();
  });
  app.post("/api/auth/login", async (req, res) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const t = Date.now();
    for (const [key, value] of attempts)
      if (value.until < t) attempts.delete(key);
    const a = attempts.get(key) || { count: 0, until: t + 60000 };
    if (a.count >= 10) {
      res
        .status(429)
        .json({ error: "Слишком много попыток. Подождите минуту." });
      return;
    }
    a.count++;
    attempts.set(key, a);
    const body = z
      .object({ password: z.string().max(512) })
      .safeParse(req.body);
    const p = body.success
      ? participantIds.find((p) => {
          const left = Buffer.from(body.data.password);
          const right = Buffer.from(config.passwords[p]);
          return left.length === right.length && timingSafeEqual(left, right);
        })
      : undefined;
    if (!p) {
      res.status(401).json({ error: "Неверный пароль" });
      return;
    }
    attempts.delete(key);
    const id = randomBytes(32).toString("hex");
    await sessions.set(id, {
      participant: p,
      expires: Date.now() + SESSION_LIFETIME,
      credentials: credentials(p),
    });
    res.cookie("session", `${id}.${signature(id)}`, {
      ...cookieOptions,
      maxAge: SESSION_LIFETIME,
    });
    res.json({ participantId: p });
  });
  app.use("/api", async (req, res, next) => {
    const session = await participant(req);
    if (!session) {
      res.status(401).json({ error: "Войдите в семейный парламент" });
      return;
    }
    res.locals.p = session.participant;
    res.locals.sessionId = session.id;
    // Browsers may cap cookie lifetime. Refresh on page load without extending
    // the original server-side ten-year expiry.
    if (req.path === "/auth/me") {
      res.cookie("session", `${session.id}.${signature(session.id)}`, {
        ...cookieOptions,
        maxAge: session.expires - Date.now(),
      });
    }
    next();
  });
  app.post("/api/auth/logout", async (_req, res) => {
    await sessions.delete(res.locals.sessionId);
    res.clearCookie("session", cookieOptions);
    res.json({ ok: true });
  });
  app.get("/api/auth/me", (_req, res) =>
    res.json({ participantId: res.locals.p }),
  );
  app.get("/api/activities", (_req, res) => res.json(activities));
  app.get("/api/state", async (_req, res, next) => {
    try {
      const result = await storage.transaction((s) => {
        tick(s, now(), random);
        return {
          state: publicState(s, res.locals.p),
          participants,
          activities,
          today: date(now()),
        };
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/history", async (_req, res, next) => {
    try {
      res.json(
        await storage.transaction((s) => {
          tick(s, now(), random);
          return s.votings.map((v) => publicVoting(v, res.locals.p));
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/votings/:id/:action", async (req, res, next) => {
    try {
      const action = req.params.action;
      if (!["complete", "skip"].includes(action)) {
        res.status(404).json({ error: "Действие не найдено" });
        return;
      }
      if (action === "skip" && res.locals.p === "daughter") {
        res
          .status(403)
          .json({ error: "Пропустить неделю могут только взрослые" });
        return;
      }
      const result = await storage.transaction((s) => {
        tick(s, now(), random);
        if (action === "complete") complete(s, req.params.id, now());
        else skip(s, req.params.id, now());
        tick(s, now(), random);
        return publicState(s, res.locals.p);
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });
  app.put("/api/votings/:id/vote", async (req, res, next) => {
    try {
      const body = z
        .object({ activityId: z.string() })
        .strict()
        .safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: "Укажите только activityId" });
        return;
      }
      // Закрытие по календарю фиксируется независимо от отклонённого позднего голоса.
      await storage.transaction((s) => tick(s, now(), random));
      res.json(
        await storage.transaction((s) => {
          tick(s, now(), random);
          if (current(s)?.id !== req.params.id)
            throw new Error("Неделя уже изменилась");
          vote(s, res.locals.p, body.data.activityId, now(), random);
          return publicState(s, res.locals.p);
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Маршрут не найден" }),
  );
  app.use(express.static(resolvePath("dist/client")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(resolvePath("dist/client/index.html")),
  );
  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof SyntaxError) {
        res.status(400).json({ error: "Некорректный JSON" });
        return;
      }
      const domain = [
        "Голосование",
        "Этой карточки",
        "Подтверждение",
        "Неделя",
        "Мероприятие",
      ];
      const known = domain.some((prefix) => error.message.startsWith(prefix));
      res.status(known ? 409 : 500).json({
        error: known
          ? error.message
          : "Не удалось выполнить операцию. Попробуйте ещё раз.",
      });
    },
  );
  return app;
}
