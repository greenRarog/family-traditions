import { describe, it, expect } from "vitest";
import {
  initial,
  tick,
  vote,
  complete,
  skip,
  selectCards,
} from "../src/domain/engine";
const friday = "2026-11-13T10:00:00Z",
  saturday = "2026-11-13T21:00:00Z";
const setup = () => {
  const s = initial();
  tick(s, friday, () => 0.999);
  return s;
};
describe("семейные правила", () => {
  it("скрывает результат до третьего голоса, начисляет звезду проигравшему", () => {
    const s = setup();
    vote(s, "father", "pizza", friday, () => 0);
    vote(s, "mother", "pizza", friday, () => 0);
    expect(s.votings[0].status).toBe("open");
    vote(s, "daughter", "cinema", friday, () => 0);
    expect(s.votings[0].winnerActivityId).toBe("pizza");
    expect(s.stars.daughter.cinema.count).toBe(1);
    expect(() => vote(s, "daughter", "pizza", friday, () => 0)).toThrow();
  });
  it("при двух разных голосах проигравший получает две звезды", () => {
    const s = setup();
    vote(s, "father", "pizza", friday, () => 0);
    vote(s, "mother", "cinema", friday, () => 0);
    tick(s, saturday, () => 0);
    expect(s.votings[0].winnerActivityId).toBe("pizza");
    expect(s.stars.mother.cinema.count).toBe(2);
    tick(s, saturday, () => 0);
    expect(s.stars.mother.cinema.count).toBe(2);
  });
  it("один голос выбирает мероприятие без звезд", () => {
    const s = setup();
    vote(s, "daughter", "pizza", friday, () => 0);
    tick(s, saturday, () => 0);
    expect(s.votings[0].winnerActivityId).toBe("pizza");
    expect(s.stars.daughter).toEqual({});
  });
  it("два одинаковых голоса не начисляют звезды", () => {
    const s = setup();
    vote(s, "father", "pizza", friday, () => 0);
    vote(s, "mother", "pizza", friday, () => 0);
    tick(s, saturday, () => 0);
    expect(s.stars.mother).toEqual({});
  });
  it("без голосов пропускает неделю и открывает следующую", () => {
    const s = setup();
    tick(s, saturday, () => 0);
    expect(s.votings[0].status).toBe("skipped");
    expect(s.votings[1].scheduledDate).toBe("2026-11-21");
  });
  it("три звезды гарантируют следующую неделю, списание только после проведения", () => {
    const s = setup();
    s.stars.daughter.cinema = { count: 2, firstEarnedAt: friday };
    vote(s, "father", "pizza", friday, () => 0);
    vote(s, "mother", "pizza", friday, () => 0);
    vote(s, "daughter", "cinema", friday, () => 0);
    expect(s.queue[0].activityId).toBe("cinema");
    expect(() => complete(s, s.votings[0].id, friday)).toThrow();
    complete(s, s.votings[0].id, saturday);
    tick(s, saturday, () => 0);
    expect(s.votings[1].resolutionType).toBe("guaranteed");
    expect(s.stars.daughter.cinema.count).toBe(3);
    complete(s, s.votings[1].id, "2026-11-20T21:00:00Z");
    expect(s.stars.daughter.cinema).toBeUndefined();
    expect(s.queue).toEqual([]);
  });
  it("включает все карточки со звездами даже сверх восьми", () => {
    const s = initial();
    for (const id of [
      "pizza",
      "cinema",
      "board-games",
      "ocean",
      "science",
      "workshop",
      "fort",
      "disco",
      "picnic",
    ])
      s.stars.father[id] = { count: 1, firstEarnedAt: friday };
    expect(selectCards(s, () => 0)).toHaveLength(9);
  });
  it("пропуск сохраняет голоса тайными до субботы", () => {
    const s = setup();
    vote(s, "father", "pizza", friday, () => 0);
    skip(s, s.votings[0].id, friday);
    expect(s.votings[0].publishedAt).toBeUndefined();
    tick(s, saturday, () => 0);
    expect(s.votings[0].publishedAt).toBe(saturday);
  });
  it("не создает пропущенные недели, блокирует новую до проведения", () => {
    const s = setup();
    vote(s, "father", "pizza", friday, () => 0);
    tick(s, "2026-12-01T10:00:00Z", () => 0);
    expect(s.votings).toHaveLength(1);
  });
});

describe("инварианты и пограничные случаи", () => {
  it("изменяет выбор до завершения и не принимает чужую карточку", () => {
    const s = setup();
    vote(s, "father", "pizza", friday, () => 0);
    vote(s, "father", "cinema", friday, () => 0);
    expect(s.votings[0].votes.father).toBe("cinema");
    expect(() => vote(s, "mother", "missing", friday, () => 0)).toThrow();
  });
  it("при трех разных вариантах выбирает один раз и ставит две карточки в очередь", () => {
    const s = setup();
    s.stars.mother.cinema = { count: 2, firstEarnedAt: friday };
    s.stars.daughter.ocean = { count: 2, firstEarnedAt: friday };
    vote(s, "father", "pizza", friday, () => 0);
    vote(s, "mother", "cinema", friday, () => 0);
    vote(s, "daughter", "ocean", friday, () => 0);
    expect(s.queue.map((q) => q.activityId)).toEqual(["ocean", "cinema"]);
    const before = JSON.stringify(s);
    tick(s, friday, () => 0.99);
    expect(JSON.stringify(s)).toBe(before);
  });
  it("объединяет гарантии по одной карточке и сохраняет их при пропуске", () => {
    const s = setup();
    s.stars.mother.cinema = { count: 3, firstEarnedAt: friday };
    s.queue.push({
      activityId: "cinema",
      participantIds: ["mother"],
      queuedAt: friday,
    });
    s.stars.daughter.cinema = { count: 2, firstEarnedAt: friday };
    vote(s, "father", "pizza", friday, () => 0);
    vote(s, "mother", "pizza", friday, () => 0);
    vote(s, "daughter", "cinema", friday, () => 0);
    expect(s.queue).toHaveLength(1);
    expect(s.queue[0].participantIds).toEqual(["mother", "daughter"]);
    skip(s, s.votings[0].id, friday);
    tick(s, saturday, () => 0);
    expect(s.votings[1].resolutionType).toBe("guaranteed");
    skip(s, s.votings[1].id, saturday);
    expect(s.stars.daughter.cinema.count).toBe(3);
    expect(s.queue).toHaveLength(1);
  });
  it("очищает звезды всех участников за проведенную карточку, повтор безопасен", () => {
    const s = setup();
    s.stars.father.pizza = { count: 1, firstEarnedAt: friday };
    s.stars.mother.pizza = { count: 2, firstEarnedAt: friday };
    vote(s, "father", "pizza", friday, () => 0);
    vote(s, "mother", "pizza", friday, () => 0);
    vote(s, "daughter", "pizza", friday, () => 0);
    complete(s, s.votings[0].id, saturday);
    const before = JSON.stringify(s);
    complete(s, s.votings[0].id, saturday);
    expect(JSON.stringify(s)).toBe(before);
    expect(s.stars.father.pizza).toBeUndefined();
    expect(s.stars.mother.pizza).toBeUndefined();
  });
  it("учитывает московскую полночь и сохраняет набор между обращениями", () => {
    const s = setup();
    const cards = [...s.votings[0].activityIds];
    tick(s, "2026-11-13T20:59:59Z", () => 0.5);
    expect(s.votings[0].status).toBe("open");
    expect(s.votings[0].activityIds).toEqual(cards);
    tick(s, "2026-11-13T21:00:00Z", () => 0.5);
    expect(s.votings[0].status).toBe("skipped");
  });
  it("не смешивает звезды участников и ограничивает начисление порогом", () => {
    const s = setup();
    s.stars.mother.cinema = { count: 2, firstEarnedAt: friday };
    s.stars.father.cinema = { count: 1, firstEarnedAt: friday };
    expect(s.queue).toHaveLength(0);
    vote(s, "father", "pizza", friday, () => 0);
    vote(s, "mother", "cinema", friday, () => 0);
    tick(s, saturday, () => 0);
    expect(s.stars.mother.cinema.count).toBe(3);
    expect(s.queue[0].participantIds).toEqual(["mother"]);
  });
});
