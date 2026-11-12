import { test, expect } from "@playwright/test";
test("три участника, три проигрыша и гарантированная суббота", async ({
  browser,
  request,
}) => {
  const contexts = await Promise.all(
    [0, 1, 2].map(() =>
      browser.newContext({ viewport: { width: 390, height: 844 } }),
    ),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  for (let i = 0; i < 3; i++) {
    await pages[i].goto("/");
    await pages[i]
      .getByLabel("Твой семейный пароль")
      .fill(["dad", "mom", "kid"][i]);
    await pages[i].getByRole("button", { name: "Войти в парламент" }).click();
    await expect(
      pages[i].getByRole("heading", { name: "Как проведём субботу?" }),
    ).toBeVisible();
  }
  for (let week = 0; week < 3; week++) {
    for (const [i, title] of [
      [2, "Кинотеатр"],
      [0, "Пиццерия"],
      [1, "Пиццерия"],
    ] as const) {
      await pages[i].reload();
      await pages[i]
        .locator(".card")
        .filter({
          has: pages[i].getByRole("heading", { name: title, exact: true }),
        })
        .click();
      await pages[i]
        .getByRole("button", { name: "Хочу провести субботу так!" })
        .click();
    }
    await expect(
      pages[1].getByRole("heading", { name: "У нас есть семейный план!" }),
    ).toBeVisible();
    await request.post("/__clock", {
      data: { now: `2026-11-${[13, 20, 27][week]}T21:00:00Z` },
    });
    await pages[0].reload();
    await pages[0].getByRole("button", { name: "Событие состоялось" }).click();
    await pages[0].getByRole("button", { name: "Да, подтверждаю" }).click();
  }
  await expect(pages[0].getByText("ЖЕЛАНИЕ ИСПОЛНЯЕТСЯ")).toBeVisible();
  await expect(pages[0].locator(".winner h2")).toHaveText("Кинотеатр");
  await request.post("/__clock", { data: { now: "2026-12-04T21:00:00Z" } });
  await pages[0].reload();
  await pages[0].getByRole("button", { name: "Событие состоялось" }).click();
  await pages[0].getByRole("button", { name: "Да, подтверждаю" }).click();
  await expect(
    pages[0].getByRole("heading", { name: "Как проведём субботу?" }),
  ).toBeVisible();
  const state = await pages[0].evaluate(async () =>
    fetch("/api/state").then((r) => r.json()),
  );
  expect(state.state.stars.daughter.cinema).toBeUndefined();
  expect(
    await pages[0].evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await pages[0].screenshot({
    path: "test-results/mobile.png",
    fullPage: true,
  });
  for (const c of contexts) await c.close();
});
