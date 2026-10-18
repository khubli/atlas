import { expect, finishSetup, fixture, importFiles, test, tripCount } from "./fixtures.js";

test("Android export: import, import again, then a newer export", async ({ page }) => {
  expect(await importFiles(page, fixture("android-2019.json"))).toMatch(/new visits added/);
  await expect(page.locator(".import-result")).toContainText("Android export");
  await finishSetup(page);
  await page.goto("./#/trips");
  await expect(page.locator(".view.active")).toContainText("Udaipur");
  const before = await tripCount(page);
  expect(before).toBeGreaterThan(0);

  expect(await importFiles(page, fixture("android-2019.json"))).toContain("Nothing new");
  expect(await tripCount(page)).toBe(before);

  expect(await importFiles(page, fixture("android-2020.json"))).toMatch(/new visits added/);
  expect(await tripCount(page)).toBeGreaterThan(before);

  await page.goto("./#/settings");
  await expect(page.locator(".import-log li")).toHaveCount(3);
});

test("iPhone export reads the same history as Android", async ({ page }) => {
  expect(await importFiles(page, fixture("ios-2019.json"))).toMatch(/new visits added/);
  await expect(page.locator(".import-result")).toContainText("iPhone export");
  await finishSetup(page);
  expect(await tripCount(page)).toBeGreaterThan(0);
  expect(await importFiles(page, fixture("android-2019.json"))).toContain("Nothing new");
});

test("an old Takeout zip fills in history, with its place names", async ({ page }) => {
  expect(await importFiles(page, fixture("takeout-2019.zip"))).toMatch(/new visits added/);
  await expect(page.locator(".import-result")).toContainText("Google Takeout");
  await finishSetup(page);
  await page.goto("./#/trips/201912200530");
  await expect(page.locator(".view.active .itinerary, .view.active")).toContainText("Hawa Mahal");
});

test("explains a file it can't use", async ({ page }) => {
  await page.goto("./#/import");
  await page.locator("#file-input").setInputFiles(fixture("Records.json"));
  await expect(page.locator("#import-progress .notice.err")).toContainText("Records.json");
  await expect(page).toHaveURL(/#\/(import|welcome)/);
});

test("your Google Maps saved places name the places you visited", async ({ page }) => {
  await importFiles(page, fixture("android-2019.json"));
  expect(await importFiles(page, fixture("Saved Places.json"))).toContain("1 saved places read");
  await page.goto("./#/places/ChIJdemo_hawa_mahal");
  await expect(page.locator(".view.active h1")).toContainText("Palace of the Winds (saved)");
  await expect(page.locator(".view.active .detail-head")).toContainText("Your Google Maps saved places");
});
