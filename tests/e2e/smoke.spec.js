import { expect, onboardDemo, test } from "./fixtures.js";

const SCREENS = [
  ["#/", ".hero"],
  ["#/trips", ".trip-card"],
  ["#/trips/201912200530", "#trip-map"],
  ["#/everyday", ".kpis"],
  ["#/map", ".place-row"],
  ["#/places", ".pt-row"],
  ["#/places/ChIJdemo_parents", "#place-form"],
  ["#/settings", "#sec-trips"],
  ["#/setup", "#setup-done"],
  ["#/import", "#import-card"],
];

test("every screen renders, light and dark, without sideways scrolling", async ({ page }) => {
  await onboardDemo(page);
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    for (const [hash, selector] of SCREENS) {
      await page.goto(`./${hash}`);
      await expect(page.locator(`.view.active ${selector}`).first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${theme} ${hash} scrolls sideways`).toBeLessThanOrEqual(0);
    }
  }
});

test("the navigation reaches every section", async ({ page, isMobile }) => {
  await onboardDemo(page);
  const nav = page.locator(isMobile ? "#bottom-nav" : ".top-nav");
  await expect(nav).toBeVisible();
  for (const [name, view] of [["Trips", "trips"], ["Everyday", "everyday"], ["Map", "map"], ["Places", "places"], ["Overview", "overview"]]) {
    await nav.getByRole("link", { name }).click();
    await expect(page.locator("body")).toHaveAttribute("data-view", view);
    await expect(nav.locator(`[data-nav="${view}"]`)).toHaveClass(/active/);
  }
});
