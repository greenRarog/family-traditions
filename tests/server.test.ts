import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { Storage } from "../src/server/storage";
import { createApp, type Config } from "../src/server/app";
import { Sessions, SESSION_LIFETIME } from "../src/server/sessions";
let dir: string, storage: Storage, server: Server, base: string;
let now = "2026-11-13T10:00:00Z";
let config: Config;
async function start() {
  server = createApp(config, storage).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error();
  base = `http://127.0.0.1:${address.port}`;
}
async function restart() {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  storage = new Storage(join(dir, "state.json"));
  await storage.init();
  await start();
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "family-test-"));
  storage = new Storage(join(dir, "state.json"));
  await storage.init();
  now = "2026-11-13T10:00:00Z";
  config = {
    passwords: { father: "dad55", mother: "mom55", daughter: "kid55" },
    secret: "a".repeat(32),
    dataPath: join(dir, "state.json"),
    secure: false,
    now: () => now,
    random: () => 0.999,
  };
  await start();
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});
async function request(
  path: string,
  cookie = "",
  method = "GET",
  body?: unknown,
) {
  return fetch(base + path, {
    method,
    headers: {
      Origin: base,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function login(password: string) {
  const r = await request("/api/auth/login", "", "POST", { password });
  expect(r.status).toBe(200);
  return r.headers.get("set-cookie")!.split(";")[0];
}
it("защищает API, скрывает голоса, принимает конкурентные запросы и сохраняет результат", async () => {
  expect((await request("/api/state")).status).toBe(401);
  const [dad, mom, kid] = await Promise.all(
    ["dad55", "mom55", "kid55"].map(login),
  );
  const state = await (await request("/api/state", dad)).json();
  const id = state.state.currentVotingId;
  expect(
    (
      await request(`/api/votings/${id}/vote`, dad, "PUT", {
        activityId: "pizza",
        participantId: "daughter",
      })
    ).status,
  ).toBe(400);
  await request(`/api/votings/${id}/vote`, kid, "PUT", {
    activityId: "cinema",
  });
  const hidden = await (await request("/api/state", dad)).json();
  expect(hidden.state.votings[0].votes).toEqual({});
  expect(hidden.state.votings[0].participation).toEqual(["daughter"]);
  expect((await request(`/api/votings/${id}/skip`, kid, "POST")).status).toBe(
    403,
  );
  const responses = await Promise.all(
    [dad, mom].map((cookie) =>
      request(`/api/votings/${id}/vote`, cookie, "PUT", {
        activityId: "pizza",
      }),
    ),
  );
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  const disk = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  expect(disk.votings[0].winnerActivityId).toBe("pizza");
  expect(disk.stars.daughter.cinema.count).toBe(1);
  const restarted = new Storage(join(dir, "state.json"));
  await restarted.init();
  expect(
    await restarted.transaction((s) => s.votings[0].winnerActivityId),
  ).toBe("pizza");
  expect(
    (
      await fetch(base + `/api/votings/${id}/skip`, {
        method: "POST",
        headers: { Cookie: dad, Origin: "https://evil.test" },
      })
    ).status,
  ).toBe(403);
  now = "2026-11-13T21:00:00Z";
  expect(
    (await request(`/api/votings/${id}/complete`, dad, "POST")).status,
  ).toBe(200);
});
it("не теряет состояние при исключении и не перезаписывает поврежденный файл", async () => {
  const before = await readFile(join(dir, "state.json"), "utf8");
  await expect(
    storage.transaction((s) => {
      s.revision = 99;
      throw Error("failure");
    }),
  ).rejects.toThrow();
  expect(await readFile(join(dir, "state.json"), "utf8")).toBe(before);
  await writeFile(join(dir, "state.json"), "broken");
  await expect(new Storage(join(dir, "state.json")).init()).rejects.toThrow(
    "повреждён",
  );
  expect(await readFile(join(dir, "state.json"), "utf8")).toBe("broken");
});
it("публикует пропущенные голоса только в субботу", async () => {
  const dad = await login("dad55"),
    mom = await login("mom55");
  const s = await (await request("/api/state", dad)).json();
  const id = s.state.currentVotingId;
  await request(`/api/votings/${id}/vote`, dad, "PUT", { activityId: "pizza" });
  await request(`/api/votings/${id}/skip`, dad, "POST");
  let history = await (await request("/api/history", mom)).json();
  expect(history[0].votes).toEqual({});
  now = "2026-11-13T21:00:00Z";
  history = await (await request("/api/history", mom)).json();
  expect(history[0].votes).toEqual({ father: "pizza" });
});

it("сохраняет вход после перезапуска, обновляет cookie и отзывает выход навсегда", async () => {
  const response = await request("/api/auth/login", "", "POST", {
    password: "dad55",
  });
  const header = response.headers.get("set-cookie")!;
  expect(header).toContain(`Max-Age=${SESSION_LIFETIME / 1000}`);
  expect(header).toContain("HttpOnly");
  expect(header).toContain("SameSite=Strict");
  const cookie = header.split(";")[0];
  const token = cookie.slice("session=".length).split(".")[0];
  const disk = await readFile(join(dir, "sessions.json"), "utf8");
  expect(disk).not.toContain(token);
  expect(disk).not.toContain("dad55");
  await restart();
  const me = await request("/api/auth/me", cookie);
  expect(me.status).toBe(200);
  expect(await me.json()).toEqual({ participantId: "father" });
  expect(me.headers.get("set-cookie")).toContain("Max-Age=");
  expect((await request("/api/auth/me", cookie + ".extra")).status).toBe(401);
  expect((await request("/api/auth/logout", cookie, "POST")).status).toBe(200);
  await restart();
  expect((await request("/api/auth/me", cookie)).status).toBe(401);
});
it("смена пароля отзывает сессии участника, смена секрета — все сессии", async () => {
  const dad = await login("dad55"),
    mom = await login("mom55");
  config.passwords.father = "new55";
  await restart();
  expect((await request("/api/auth/me", dad)).status).toBe(401);
  expect((await request("/api/auth/me", mom)).status).toBe(200);
  config.secret = "b".repeat(32);
  await restart();
  expect((await request("/api/auth/me", mom)).status).toBe(401);
});
it("проверяет срок сессий и не заменяет повреждённый файл пустым", async () => {
  const cookie = await login("dad55");
  const path = join(dir, "sessions.json");
  const sessions = JSON.parse(await readFile(path, "utf8"));
  sessions[Object.keys(sessions)[0]].expires = Date.now() - 1;
  await writeFile(path, JSON.stringify(sessions));
  expect((await request("/api/auth/me", cookie)).status).toBe(401);
  await writeFile(path, "broken");
  expect(
    (await request("/api/auth/login", "", "POST", { password: "dad55" }))
      .status,
  ).toBe(500);
  expect(await readFile(path, "utf8")).toBe("broken");
});
it("сохраняет конкурентные сессии", async () => {
  const store = new Sessions(join(dir, "sessions.json"));
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      store.set(`token${i}`, {
        participant: "father",
        expires: Date.now() + SESSION_LIFETIME,
        credentials: "test",
      }),
    ),
  );
  expect(
    Object.keys(JSON.parse(await readFile(join(dir, "sessions.json"), "utf8"))),
  ).toHaveLength(10);
});
it("не доверяет поддельному X-Forwarded-For при прямом доступе", async () => {
  for (let i = 0; i < 10; i++) {
    await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        "X-Forwarded-For": `198.51.100.${i}`,
      },
      body: JSON.stringify({ password: "wrong" }),
    });
  }
  expect(
    (await request("/api/auth/login", "", "POST", { password: "dad55" }))
      .status,
  ).toBe(429);
});
it("разделяет лимит по IP только за доверенным прокси", async () => {
  config.trustedProxy = "loopback";
  await restart();
  const attempt = (ip: string) =>
    fetch(base + "/api/auth/login", {
      method: "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        "X-Forwarded-For": ip,
      },
      body: JSON.stringify({ password: "wrong" }),
    });
  for (let i = 0; i < 10; i++)
    expect((await attempt("198.51.100.1")).status).toBe(401);
  expect((await attempt("198.51.100.1")).status).toBe(429);
  expect((await attempt("198.51.100.2")).status).toBe(401);
});
