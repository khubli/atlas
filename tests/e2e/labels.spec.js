import { DEMO_FILE, expect, importFiles, onboardDemo, test, tripCount } from "./fixtures.js";

const PARENTS = "./#/places/ChIJdemo_parents";

test("your name and kind for a place survive reloads and re-imports", async ({ page }) => {
  await onboardDemo(page);
  await page.goto(PARENTS);
  await expect(page.locator(".view.active .detail-head")).toContainText("No name yet");
  await page.locator('#place-form [name="name"]').fill("Grandparents' house");
  await page.locator('#place-form input[name="kind"][value="family"]').check({ force: true });
  await page.locator('#place-form button[type="submit"]').click();
  await expect(page.locator(".view.active h1")).toContainText("Grandparents' house");
  await expect(page.locator(".view.active .detail-head")).toContainText("Family home · You");

  await page.reload();
  await expect(page.locator(".view.active h1")).toContainText("Grandparents' house");

  expect(await importFiles(page, DEMO_FILE)).toContain("Nothing new");
  await page.goto(PARENTS);
  await expect(page.locator(".view.active h1")).toContainText("Grandparents' house");

  await page.goto("./#/places");
  await page.locator("#places-q").fill("Grandparents");
  await expect(page.locator(".pt-row")).toContainText(["Grandparents' house"]);
});

test("bulk labelling from the review queue", async ({ page }) => {
  await onboardDemo(page);
  await page.goto("./#/places");
  const rows = page.locator(".view.active .pt-row");
  await expect(rows.first()).toBeVisible();
  const queued = await rows.count();
  await page.locator("#select-all").check();
  await expect(page.locator("#bulk-bar")).toBeVisible();
  await page.locator('#bulk-bar [data-bulk-hide="1"]').click();
  await expect(page.locator("#toast")).toContainText("Updated");
  await page.locator('[data-filter="hidden"]').click();
  await expect(rows).toHaveCount(queued);
});

test("trips can be renamed and set aside", async ({ page }) => {
  await onboardDemo(page);
  await page.goto("./#/trips/201912200530");
  await expect(page.locator("#trip-title")).toHaveText("Udaipur, Jaipur & Chittorgarh");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "Trip name" }).fill("Rajasthan, winter 2019");
  await page.keyboard.press("Enter");
  await expect(page.locator("#trip-title")).toHaveText("Rajasthan, winter 2019");
  await page.reload();
  await expect(page.locator("#trip-title")).toHaveText("Rajasthan, winter 2019");

  await page.getByRole("button", { name: "Not a trip" }).click();
  await expect(page.locator(".view.active .notice")).toContainText("Hidden");
  expect(await tripCount(page)).toBe(19);

  await page.goto("./#/trips");
  await expect(page.locator("#trip-groups")).not.toContainText("Rajasthan, winter 2019");
  await page.locator('[data-f="hidden"]').check();
  await expect(page.locator("#trip-groups")).toContainText("Rajasthan, winter 2019");
});

test("a place can be renamed right from a trip's itinerary", async ({ page }) => {
  await onboardDemo(page);
  await page.goto("./#/trips/201912200530");
  await page.getByRole("button", { name: "Rename Hawa Mahal" }).click();
  await page.getByRole("textbox", { name: "Place name" }).fill("Palace of Winds");
  await page.keyboard.press("Enter");
  await expect(page.locator(".view.active .trip-detail")).toContainText("Palace of Winds");
  await page.goto("./#/places");
  await page.locator("#places-q").fill("Palace of Winds");
  await expect(page.locator(".pt-row")).toContainText(["Palace of Winds"]);
});
