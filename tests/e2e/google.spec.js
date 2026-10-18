import { expect, finishSetup, fixture, importFiles, test } from "./fixtures.js";

// Stands in for the Maps JavaScript API: Place({ id }).fetchFields() answers with a
// made-up name, and says NOT_FOUND for the workplace.
const FAKE_MAPS = `
window.google = { maps: { importLibrary: async () => ({ Place: class {
  constructor({ id }) { this.id = id; }
  async fetchFields() {
    window.__lookups = (window.__lookups || 0) + 1;
    if (this.id.endsWith("_work")) throw new Error("NOT_FOUND: Place not found");
    this.displayName = "Google: " + this.id.replace("ChIJdemo_", "");
    this.types = ["tourist_attraction", "point_of_interest"];
    this.primaryType = "tourist_attraction";
    this.formattedAddress = "Somewhere, India";
    this.googleMapsURI = "https://maps.google.com/?cid=1";
  }
} }) } };
window.__atlasMapsReady();
`;

test("names places with Google using the person's own key", async ({ page, context }) => {
  let keyInUrl = null;
  await context.route(/maps\.googleapis\.com\/maps\/api\/js/, (route) => {
    keyInUrl = new URL(route.request().url()).searchParams.get("key");
    return route.fulfill({ contentType: "text/javascript", body: FAKE_MAPS });
  });
  await importFiles(page, fixture("android-2019.json"));
  await finishSetup(page);

  await page.goto("./#/settings");
  await expect(page.locator("#btn-google")).toBeDisabled();
  await page.locator("#google-key").fill("AIzaFAKE-e2e-key");
  // Saving a key starts naming straight away.
  await page.locator("#btn-save-key").click();
  await expect(page.locator("#toast")).toContainText("Names from Google saved");
  const asked = await page.evaluate(() => window.__lookups);
  expect(asked).toBeGreaterThan(0);
  expect(keyInUrl).toBe("AIzaFAKE-e2e-key");
  await expect(page.locator("#sec-names")).toContainText(`${asked} of 5,000`);
  await expect(page.locator("#btn-google")).toBeDisabled();

  await page.goto("./#/places/ChIJdemo_hawa_mahal");
  await expect(page.locator(".view.active h1")).toContainText("Google: hawa_mahal");
  await expect(page.locator(".view.active .detail-head")).toContainText("Name · Google");
});
