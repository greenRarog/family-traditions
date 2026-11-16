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
    await pages[i].getByRole("button", { name: "Войти", exact: true }).click();
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

test("описание проекта и раскрывающийся вход на телефоне и компьютере", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Семейный парламент." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Исходный код на GitHub" }),
  ).toHaveAttribute("href", "https://github.com/greenRarog/family-traditions");
  await expect(page.getByLabel("Твой семейный пароль")).toHaveCount(0);
  const toggle = page.getByRole("button", { name: "Войти", exact: true });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await toggle.click();
    await expect(page.getByLabel("Твой семейный пароль")).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  }
  await toggle.click();
  await page.getByLabel("Твой семейный пароль").fill("wrong");
  await page.getByRole("button", { name: "Войти в парламент" }).click();
  await expect(page.getByRole("alert")).toHaveText("Неверный пароль");
  await expect(page.getByRole("button", { name: "Повторить" })).toHaveCount(0);
  await page.getByRole("heading", { name: "Семейный парламент." }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(toggle).toBeVisible();
  await page.screenshot({
    path: "test-results/landing-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/landing-mobile.png",
    fullPage: true,
  });
});
