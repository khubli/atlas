import { readFile } from "node:fs/promises";
import { controlledBySw, expect, fixture, onboardDemo, test } from "./fixtures.js";

test("the manifest makes Atlas installable, a share target and a file handler", async ({ request }) => {
  const m = await (await request.get("manifest.webmanifest")).json();
  expect(m).toMatchObject({ name: "Atlas", display: "standalone", start_url: "./", scope: "./" });
  expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(m.icons.some((i) => i.purpose === "maskable")).toBe(true);
  expect(m.share_target).toMatchObject({ action: "./share-target", method: "POST", enctype: "multipart/form-data" });
  expect(m.share_target.params.files[0].accept).toEqual(expect.arrayContaining([".json", ".zip"]));
  expect(m.file_handlers[0].accept["application/json"]).toContain(".json");
});

test("works offline once it has loaded", async ({ page, context }) => {
  await onboardDemo(page);
  await controlledBySw(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".view.active .hero")).toContainText("20 trips");
  await expect(page.locator("#offline-banner")).toBeVisible();
  await page.goto("./#/trips/201912200530");
  await expect(page.locator("#trip-title")).toBeVisible();
  await page.goto("./#/everyday");
  await expect(page.locator(".view.active .kpis")).toBeVisible();
  await context.setOffline(false);
});

test("a file shared from Android's share sheet is imported", async ({ page }) => {
  await page.goto("./");
  await controlledBySw(page);
  const json = await readFile(fixture("android-2019.json"), "utf8");
  // What the OS does on Share -> Atlas: a multipart POST navigation to the share_target action.
  await page.evaluate((text) => {
    const form = Object.assign(document.createElement("form"), { method: "POST", action: "./share-target", enctype: "multipart/form-data" });
    const input = Object.assign(document.createElement("input"), { type: "file", name: "file" });
    const dt = new DataTransfer();
    dt.items.add(new File([text], "Timeline.json", { type: "application/json" }));
    input.files = dt.files;
    form.append(input);
    document.body.append(form);
    form.submit();
  }, json);
  await expect(page).toHaveURL(/#\/import\?shared=1/);
  await expect(page.locator(".import-result")).toContainText("new visits added", { timeout: 60_000 });
});
