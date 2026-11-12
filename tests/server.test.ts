import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { Storage } from "../src/server/storage";
import { createApp } from "../src/server/app";
let dir: string, storage: Storage, server: Server, base: string;
let now = "2026-11-13T10:00:00Z";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "family-test-"));
  storage = new Storage(join(dir, "state.json"));
  await storage.init();
  now = "2026-11-13T10:00:00Z";
  server = createApp(
    {
      passwords: { father: "dad", mother: "mom", daughter: "kid" },
      secret: "a".repeat(32),
      dataPath: join(dir, "state.json"),
      secure: false,
      now: () => now,
      random: () => 0.999,
    },
    storage,
  ).listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error();
  base = `http://127.0.0.1:${address.port}`;
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
  const [dad, mom, kid] = await Promise.all(["dad", "mom", "kid"].map(login));
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
  const dad = await login("dad"),
    mom = await login("mom");
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
