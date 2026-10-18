// Shared setup for the end-to-end tests: no real network (map tiles are a blank
// image, anything else off this machine is refused), dialogs accepted, and any
// console error or uncaught exception fails the test.

import { test as base, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

export { expect };
export const fixture = (name) => fileURLToPath(new URL(`./.fixtures/${name}`, import.meta.url));
export const DEMO_FILE = fileURLToPath(new URL("../../public/demo/timeline.json", import.meta.url));

const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const NO_GOOGLE = `window.google = { maps: { importLibrary: async () => ({ Place: class {
  async fetchFields() { throw new Error("NOT_FOUND"); } } }) } }; window.__atlasMapsReady();`;

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => {
      const url = route.request().url();
      if (url.includes("tile.openstreetmap.org")) return route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG });
      // Naming runs on its own after an import; OpenStreetMap "finds nothing".
      if (url.includes("overpass")) return route.fulfill({ status: 200, contentType: "application/json", body: '{"elements":[]}' });
      // Saving a Google key starts naming; Google "doesn't know" any place (google.spec.js answers properly).
      if (url.includes("maps.googleapis.com/maps/api/js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: NO_GOOGLE });
      return route.abort("blockedbyclient");
    });
    await use(context);
  },
  page: async ({ page }, use, testInfo) => {
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
    page.on("dialog", (d) => d.accept());
    await use(page);
    if (!testInfo.annotations.some((a) => a.type === "allow-console-errors")) {
      expect(errors, "console errors").toEqual([]);
    }
  },
});

/** Fresh profile -> "Try with demo data" -> import result. */
export async function importDemo(page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Try with demo data" }).click();
  await expect(page.locator(".import-result")).toBeVisible({ timeout: 60_000 });
}

/** Import files from the import screen and wait for the result card. */
export async function importFiles(page, files) {
  await page.goto("./#/import");
  await page.locator("#file-input").setInputFiles(files);
  await expect(page.locator(".import-result")).toBeVisible({ timeout: 60_000 });
  return (await page.locator(".import-result strong").innerText()).trim();
}

/** From the import result through the setup checks to the overview. */
export async function finishSetup(page) {
  await page.locator(".import-result .btn").click();
  await page.locator("#setup-done").click();
  await expect(page.locator(".view.active .hero")).toBeVisible();
}

export async function onboardDemo(page) {
  await importDemo(page);
  await finishSetup(page);
}

/** The number on the overview's Trips tile. */
export async function tripCount(page) {
  await page.goto("./#/");
  const value = page.locator('.view.active .kpi:has(.label:text-is("Trips")) .value');
  await expect(value).toBeVisible();
  return Number((await value.innerText()).replace(/[^\d]/g, ""));
}

/** Wait until the service worker controls the page (it takes over from the second load). */
export async function controlledBySw(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}
