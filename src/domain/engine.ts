import {
  activities,
  participantIds,
  type ParticipantId,
  settings,
} from "./catalog";
export type Random = () => number;
export type Voting = {
  id: string;
  weekDate: string;
  scheduledDate: string;
  status: "open" | "scheduled" | "completed" | "skipped";
  activityIds: string[];
  votes: Partial<Record<ParticipantId, string>>;
  winnerActivityId?: string;
  resolutionType?: "majority" | "lottery" | "guaranteed";
  awardedStars: Partial<Record<ParticipantId, number>>;
  guaranteedParticipantIds: ParticipantId[];
  createdAt: string;
  resolvedAt?: string;
  publishedAt?: string;
  completedAt?: string;
  skippedAt?: string;
};
export type State = {
  schemaVersion: 1;
  revision: number;
  currentVotingId?: string;
  votings: Voting[];
  stars: Record<
    ParticipantId,
    Record<string, { count: number; firstEarnedAt: string }>
  >;
  queue: {
    activityId: string;
    participantIds: ParticipantId[];
    queuedAt: string;
  }[];
};
export const initial = (): State => ({
  schemaVersion: 1,
  revision: 0,
  votings: [],
  stars: { father: {}, mother: {}, daughter: {} },
  queue: [],
});
export const date = (now: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
export function nextSaturday(now: string) {
  const d = new Date(`${date(now)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
const shuffle = <T>(items: T[], random: Random) => {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
export function selectCards(s: State, random: Random) {
  const all = activities.map((a) => a.id);
  const priority = all.filter((id) =>
    participantIds.some((p) => s.stars[p][id]?.count > 0),
  );
  return shuffle(
    [
      ...priority,
      ...shuffle(
        all.filter((id) => !priority.includes(id)),
        random,
      ).slice(0, Math.max(0, settings.cardCount - priority.length)),
    ],
    random,
  );
}
export const current = (s: State) =>
  s.votings.find((v) => v.id === s.currentVotingId);
export function resolve(s: State, v: Voting, now: string, random: Random) {
  if (v.status !== "open") return;
  const votes = Object.entries(v.votes) as [ParticipantId, string][];
  v.publishedAt = now;
  v.resolvedAt = now;
  if (!votes.length) {
    v.status = "skipped";
    v.skippedAt = now;
    return;
  }
  const counts = new Map<string, number>();
  for (const [, id] of votes) counts.set(id, (counts.get(id) || 0) + 1);
  const max = Math.max(...counts.values());
  const tied = [...counts].filter(([, n]) => n === max).map(([id]) => id);
  const winner = tied[Math.floor(random() * tied.length)];
  v.winnerActivityId = winner;
  v.resolutionType = tied.length > 1 ? "lottery" : "majority";
  v.status = "scheduled";
  const queued: string[] = [];
  for (const [p, id] of votes) {
    if (id === winner) continue;
    const amount = votes.length === 2 ? 2 : 1;
    const old = s.stars[p][id] || { count: 0, firstEarnedAt: now };
    const count = Math.min(settings.starThreshold, old.count + amount);
    v.awardedStars[p] = count - old.count;
    s.stars[p][id] = { ...old, count };
    if (count === settings.starThreshold) {
      const q = s.queue.find((q) => q.activityId === id);
      if (q) {
        if (!q.participantIds.includes(p)) q.participantIds.push(p);
      } else if (!queued.includes(id)) queued.push(id);
    }
  }
  for (const id of shuffle(queued, random))
    s.queue.push({
      activityId: id,
      participantIds: participantIds.filter(
        (p) => s.stars[p][id]?.count === settings.starThreshold,
      ),
      queuedAt: now,
    });
}
export function tick(s: State, now: string, random: Random) {
  const today = date(now);
  for (const v of s.votings) {
    if (v.status === "skipped" && !v.publishedAt && v.scheduledDate <= today)
      v.publishedAt = now;
  }
  const previous = current(s);
  if (previous?.status === "open" && previous.scheduledDate <= today)
    resolve(s, previous, now, random);
  if (
    previous &&
    (previous.status === "open" || previous.status === "scheduled")
  )
    return;
  const target = nextSaturday(now);
  if (s.votings.some((v) => v.scheduledDate === target)) return;
  const q = s.queue[0];
  const v: Voting = {
    id: target,
    weekDate: target,
    scheduledDate: target,
    status: q ? "scheduled" : "open",
    activityIds: q ? [q.activityId] : selectCards(s, random),
    votes: {},
    awardedStars: {},
    guaranteedParticipantIds: q ? [...q.participantIds] : [],
    createdAt: now,
  };
  if (q) {
    v.winnerActivityId = q.activityId;
    v.resolutionType = "guaranteed";
    v.publishedAt = now;
    v.resolvedAt = now;
  }
  s.votings.push(v);
  s.currentVotingId = v.id;
}
export function vote(
  s: State,
  p: ParticipantId,
  id: string,
  now: string,
  random: Random,
) {
  const v = current(s);
  if (!v || v.status !== "open") throw new Error("Голосование уже закрыто");
  if (!v.activityIds.includes(id))
    throw new Error("Этой карточки нет в голосовании");
  v.votes[p] = id;
  if (Object.keys(v.votes).length === 3) resolve(s, v, now, random);
}
export function complete(s: State, id: string, now: string) {
  const v = s.votings.find((v) => v.id === id);
  if (v?.status === "completed") return;
  if (!v || v.status !== "scheduled" || v.scheduledDate > date(now))
    throw new Error("Подтверждение доступно с даты мероприятия");
  v.status = "completed";
  v.completedAt = now;
  for (const p of participantIds) delete s.stars[p][v.winnerActivityId!];
  s.queue = s.queue.filter((q) => q.activityId !== v.winnerActivityId);
}
export function skip(s: State, id: string, now: string) {
  const v = current(s);
  if (!v || v.id !== id) throw new Error("Неделя уже изменилась");
  if (v.status === "skipped") return;
  if (v.status === "completed") throw new Error("Мероприятие уже состоялось");
  v.status = "skipped";
  v.skippedAt = now;
}
export function publicVoting(v: Voting, p: ParticipantId) {
  return {
    ...v,
    votes: v.publishedAt ? v.votes : { [p]: v.votes[p] },
    participation: participantIds.filter((p) => v.votes[p]),
  };
}
export function publicState(s: State, p: ParticipantId) {
  return { ...s, votings: s.votings.map((v) => publicVoting(v, p)) };
}
