import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const sessionSchema = z.object({
  participant: z.enum(["father", "mother", "daughter"]),
  expires: z.number().finite(),
  credentials: z.string(),
});
const schema = z.record(z.string(), sessionSchema);
export type Session = z.infer<typeof sessionSchema>;
export const SESSION_LIFETIME = 10 * 365 * 24 * 60 * 60 * 1000;

// One application process per volume, as for state.json. Only token hashes
// are stored; all mutations are serialized and atomically replace the file.
export class Sessions {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private path: string) {}

  private key(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private async read() {
    try {
      return schema.parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error(
        "Не удалось прочитать файл сессий; исходный файл сохранён.",
        { cause: error },
      );
    }
  }

  private mutate(fn: (sessions: Record<string, Session>) => void) {
    const operation = this.tail.then(async () => {
      const sessions = await this.read();
      for (const [key, session] of Object.entries(sessions)) {
        if (session.expires <= Date.now()) delete sessions[key];
      }
      fn(sessions);
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${randomBytes(8).toString("hex")}.tmp`;
      try {
        const file = await open(temp, "wx", 0o600);
        try {
          await file.writeFile(JSON.stringify(sessions));
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temp, this.path);
      } finally {
        await unlink(temp).catch(() => {});
      }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }

  async get(token: string) {
    await this.tail;
    const session = (await this.read())[this.key(token)];
    return session && session.expires > Date.now() ? session : undefined;
  }

  async check() {
    await this.tail;
    await this.read();
  }

  set(token: string, session: Session) {
    return this.mutate((sessions) => {
      sessions[this.key(token)] = session;
    });
  }

  delete(token: string) {
    return this.mutate((sessions) => {
      delete sessions[this.key(token)];
    });
  }
}
