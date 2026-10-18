import { expect, finishSetup, fixture, test, tripCount } from "./fixtures.js";

// A ~100 MB export (years of history plus a dense raw GPS trail) on a slowed-down CPU.
// Opt-in because it takes a while: ATLAS_SCALE=1 npm run test:e2e -- scale
test("a ~100 MB export imports on a slow device", async ({ page }, testInfo) => {
  test.skip(!process.env.ATLAS_SCALE, "set ATLAS_SCALE=1 to run");
  test.setTimeout(15 * 60_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  await page.goto("./#/import");
  const started = Date.now();
  await page.locator("#file-input").setInputFiles(fixture("big-android.json"));
  await expect(page.locator(".import-result")).toBeVisible({ timeout: 12 * 60_000 });
  const seconds = Math.round((Date.now() - started) / 1000);
  testInfo.annotations.push({ type: "import-seconds", description: String(seconds) });
  console.log(`big-android.json imported in ${seconds}s`);

  await finishSetup(page);
  expect(await tripCount(page)).toBe(20);
});
