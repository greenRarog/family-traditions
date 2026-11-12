import express from "express";
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  randomInt,
} from "node:crypto";
import { resolve as resolvePath } from "node:path";
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
export type Config = {
  passwords: Record<ParticipantId, string>;
  secret: string;
  dataPath: string;
  secure: boolean;
  now?: () => string;
  random?: Random;
};
export function createApp(config: Config, storage: Storage) {
  const app = express();
  app.disable("x-powered-by");
  const now = config.now || (() => new Date().toISOString());
  const random =
    config.random || (() => randomInt(0, 0x100000000) / 0x100000000);
  const sessions = new Map<string, { p: ParticipantId; expires: number }>();
  const attempts = new Map<string, { count: number; until: number }>();
  const signature = (id: string) =>
    createHmac("sha256", config.secret).update(id).digest("hex");
  const participant = (req: express.Request) => {
    const cookie = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("session="))
      ?.slice(8);
    if (!cookie) return;
    const [id, sig] = cookie.split(".");
    if (
      !id ||
      !sig ||
      !/^[a-f0-9]{64}$/.test(sig) ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(signature(id)))
    )
      return;
    const session = sessions.get(id);
    if (session && session.expires > Date.now()) return session.p;
    sessions.delete(id);
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
  app.post("/api/auth/login", (req, res) => {
    const key = req.socket.remoteAddress || "unknown";
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
    for (const [id, s] of sessions) if (s.expires < t) sessions.delete(id);
    const id = randomBytes(32).toString("hex");
    sessions.set(id, { p, expires: t + 30 * 86400000 });
    res.cookie("session", `${id}.${signature(id)}`, {
      httpOnly: true,
      sameSite: "strict",
      secure: config.secure,
      maxAge: 30 * 86400000,
      path: "/",
    });
    res.json({ participantId: p });
  });
  app.use("/api", (req, res, next) => {
    const p = participant(req);
    if (!p) {
      res.status(401).json({ error: "Войдите в семейный парламент" });
      return;
    }
    res.locals.p = p;
    next();
  });
  app.post("/api/auth/logout", (req, res) => {
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)session=([^.]+)/);
    if (cookie) sessions.delete(cookie[1]);
    res.clearCookie("session", { path: "/" });
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
