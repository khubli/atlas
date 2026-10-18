import { expect, importDemo, onboardDemo, test, tripCount } from "./fixtures.js";

test("a first visit starts at the welcome screen", async ({ page }) => {
  await page.goto("./#/trips");
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.getByRole("heading", { name: /Your travels, rebuilt/ })).toBeVisible();
  await expect(page.locator("#guide-steps")).toContainText("Export Timeline data");
  await expect(page.locator(".top-nav")).toBeHidden();
});

test("demo data: setup checks, then the overview", async ({ page }) => {
  await importDemo(page);
  await expect(page.locator(".import-result")).toContainText("new visits added");
  await page.locator(".import-result .btn").click();
  await expect(page.getByRole("heading", { name: "Check what Atlas found" })).toBeVisible();
  await expect(page.locator(".setup-row").first()).toContainText("Bengaluru");
  const family = page.locator(".setup-row.toggle-row").first();
  await expect(family).toContainText("Mysuru");
  await expect(family.locator('input[type="checkbox"]')).toBeChecked();
  await expect(page.locator("#names-card").getByRole("link", { name: "Import saved places" })).toBeVisible();
  await page.locator("#setup-done").click();
  await expect(page.locator(".view.active .hero")).toContainText("20 trips");
  await expect(page.locator(".lens-chip")).toContainText("50 km");
});

test("trip rules decide what counts as a trip, and stick", async ({ page }) => {
  await onboardDemo(page);
  expect(await tripCount(page)).toBe(20);

  await page.goto("./#/settings");
  await page.locator('#sec-trips [data-lens="familyIsBase"]').check();
  await expect(page.locator("#toast")).toContainText("15 trips");
  expect(await tripCount(page)).toBe(15);

  await page.goto("./#/settings");
  await page.locator('#sec-trips [data-lens="awayKm"]').selectOption("200");
  await expect(page.locator("#toast")).toContainText("with these rules");
  const far = await tripCount(page);
  expect(far).toBeLessThan(15);

  await page.reload();
  expect(await tripCount(page)).toBe(far);
  await expect(page.locator(".lens-chip")).toContainText("200 km");
});
