// Takes the README screenshots from the built-in demo traveller (never real data).
//   npm run build && npx vite preview --port 4173 &
//   node scripts/screenshots.mjs [http://127.0.0.1:4173/] [docs/screenshots]
// PW_CHROMIUM points at a local Chromium; HTTPS_PROXY (if set) is used for map tiles.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, devices } from "@playwright/test";

const base = process.argv[2] || "http://127.0.0.1:4173/";
const out = process.argv[3] || "docs/screenshots";
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;

const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  args: proxy ? [`--proxy-server=${proxy}`, "--proxy-bypass-list=<loopback>;127.0.0.1;localhost"] : [],
});
await mkdir(out, { recursive: true });

/** A fresh profile with the demo imported and setup done. Naming lookups are switched off. */
async function demoPage(options, scheme) {
  const context = await browser.newContext({ ...options, colorScheme: scheme, timezoneId: "Asia/Kolkata", locale: "en-US" });
  await context.route(/overpass|maps\.googleapis/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"elements":[]}' }));
  const page = await context.newPage();
  await page.goto(base);
  await page.getByRole("button", { name: "Try with demo data" }).click();
  await page.locator(".import-result .btn").click({ timeout: 60_000 });
  await page.locator("#setup-done").click();
  await page.locator(".view.active .hero").waitFor();
  return page;
}

async function shot(page, hash, selector, settle = 1500) {
  await page.goto(new URL(hash, base).href);
  await page.locator(`.view.active ${selector}`).first().waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(settle); // map tiles and chart transitions
  return page.screenshot();
}

const desktop = await demoPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 }, "light");
await writeFile(join(out, "overview.png"), await shot(desktop, "#/", ".hero"));
await writeFile(join(out, "trip.png"), await shot(desktop, "#/trips/201912200530", "#trip-map", 3000));
await writeFile(join(out, "places.png"), await shot(desktop, "#/places", ".pt-row"));

// Three phone screens in dark mode, side by side.
const phone = await demoPage(devices["Pixel 7"], "dark");
const screens = [];
for (const [hash, selector] of [["#/", ".hero"], ["#/trips/201912200530", "#trip-map"], ["#/everyday", ".kpis"]]) {
  screens.push((await shot(phone, hash, selector, 2500)).toString("base64"));
}
const sheet = await browser.newPage({ viewport: { width: 1240, height: 900 } });
await sheet.setContent(`<style>
  body { margin: 0; background: #0e1419; display: flex; gap: 28px; justify-content: center; align-items: center; height: 900px; }
  img { width: 380px; border-radius: 28px; box-shadow: 0 0 0 1px #2a3640; }
</style>${screens.map((s) => `<img src="data:image/png;base64,${s}">`).join("")}`);
await sheet.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
await writeFile(join(out, "mobile.png"), await sheet.screenshot());

await browser.close();
console.log(`screenshots -> ${out}`);
