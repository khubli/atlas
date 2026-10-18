import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { expect, onboardDemo, test } from "./fixtures.js";

test("back up, delete everything, restore", async ({ page }, testInfo) => {
  await onboardDemo(page);
  await page.goto("./#/places/ChIJdemo_parents");
  await page.locator('#place-form [name="name"]').fill("Grandparents' house");
  await page.locator('#place-form button[type="submit"]').click();
  await expect(page.locator(".view.active h1")).toContainText("Grandparents' house");

  // A Google key is saved on the device but must never leave it in a backup.
  await page.goto("./#/settings");
  await page.locator("#google-key").fill("AIzaFAKE-e2e-key");
  await page.locator("#btn-save-key").click();
  await expect(page.locator("#google-key")).toHaveAttribute("placeholder", /Key saved/);

  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#btn-backup").click()]);
  expect(download.suggestedFilename()).toMatch(/^atlas-backup-\d{4}-\d{2}-\d{2}\.atlas$/);
  const file = testInfo.outputPath("backup.atlas");
  await download.saveAs(file);
  const text = gunzipSync(await readFile(file)).toString();
  expect(JSON.parse(text).format).toBe("atlas-backup");
  expect(text).toContain("Grandparents' house");
  expect(text).not.toContain("AIzaFAKE");

  await page.locator("#btn-delete").click();
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.getByRole("button", { name: "Try with demo data" })).toBeVisible();

  await page.goto("./#/settings");
  await expect(page.locator("#sec-data")).toContainText("Nothing imported yet");
  await page.locator("#restore-input").setInputFiles(file);
  await expect(page.locator(".view.active .hero")).toContainText("20 trips");
  await page.goto("./#/places/ChIJdemo_parents");
  await expect(page.locator(".view.active h1")).toContainText("Grandparents' house");
});
