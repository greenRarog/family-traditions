import { mkdir, readFile, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { initial, type State } from "../domain/engine";
import { z } from "zod";
const pid = z.enum(["father", "mother", "daughter"]);
const activityId = z.enum([
  "pizza",
  "cinema",
  "board-games",
  "ocean",
  "science",
  "workshop",
  "fort",
  "disco",
  "picnic",
  "treasure",
  "theatre",
  "expedition",
]);
const stamp = z.string().datetime();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const votes = z.partialRecord(pid, activityId);
const schema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  currentVotingId: z.string().optional(),
  votings: z.array(
    z.object({
      id: z.string(),
      weekDate: day,
      scheduledDate: day,
      status: z.enum(["open", "scheduled", "completed", "skipped"]),
      activityIds: z.array(activityId),
      votes,
      winnerActivityId: activityId.optional(),
      resolutionType: z.enum(["majority", "lottery", "guaranteed"]).optional(),
      awardedStars: z.partialRecord(pid, z.number().int().min(0).max(2)),
      guaranteedParticipantIds: z.array(pid),
      createdAt: stamp,
      resolvedAt: stamp.optional(),
      publishedAt: stamp.optional(),
      completedAt: stamp.optional(),
      skippedAt: stamp.optional(),
    }),
  ),
  stars: z.record(
    pid,
    z.record(
      z.string(),
      z.object({ count: z.number().int().min(1).max(3), firstEarnedAt: stamp }),
    ),
  ),
  queue: z.array(
    z.object({ activityId, participantIds: z.array(pid), queuedAt: stamp }),
  ),
});
export class Storage {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private path: string) {}
  async init() {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const data = JSON.parse(await readFile(this.path, "utf8"));
      schema.parse(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await this.save(initial());
      } else
        throw new Error(
          "Файл состояния повреждён или несовместим. Исходный файл сохранён.",
          { cause: error },
        );
    }
  }
  private async save(s: State) {
    const temp = `${this.path}.tmp`;
    try {
      const handle = await open(temp, "w", 0o600);
      try {
        await handle.writeFile(JSON.stringify(s));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, this.path);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  }
  transaction<T>(fn: (state: State) => T): Promise<T> {
    const operation = this.tail.then(async () => {
      const state = schema.parse(
        JSON.parse(await readFile(this.path, "utf8")),
      ) as State;
      const before = JSON.stringify(state);
      const result = fn(state);
      if (JSON.stringify(state) !== before) {
        state.revision++;
        await this.save(state);
      }
      return result;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
