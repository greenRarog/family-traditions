import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app";
import { Storage } from "../src/server/storage";
let now = "2026-11-13T10:00:00Z";
const dir = await mkdtemp(join(tmpdir(), "parliament-e2e-"));
const storage = new Storage(join(dir, "state.json"));
await storage.init();
const app = express();
app.post("/__clock", express.json(), (req, res) => {
  now = req.body.now;
  res.json({ ok: true });
});
app.use(
  createApp(
    {
      passwords: { father: "dad", mother: "mom", daughter: "kid" },
      secret: "test-only-secret-not-for-production",
      secure: false,
      dataPath: join(dir, "state.json"),
      now: () => now,
      random: () => 0.999,
    },
    storage,
  ),
);
const server = app.listen(8091, "127.0.0.1");
process.on("SIGTERM", () =>
  server.close(() => {
    void rm(dir, { recursive: true, force: true }).then(() => process.exit());
  }),
);
