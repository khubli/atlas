// Draws the Atlas logo ("round trip": a route that leaves the home dot, reaches a
// destination and comes back) and renders every icon size the app uses.
//   node scripts/build-icons.mjs        (PW_CHROMIUM=... if Playwright's browser isn't installed)

import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const NAVY = "#13202e";
const TEAL = "#19c2ad";
const AMBER = "#f2b33d";
const WHITE = "#f4f7f8";

// The mark on a 512 grid, centred on (256, 256).
const MARK = `
  <path d="M178 372 C 96 300, 112 150, 238 120 C 352 92, 430 176, 392 250 C 356 318, 262 344, 178 372 Z"
    fill="none" stroke="${TEAL}" stroke-width="40" stroke-linejoin="round"/>
  <circle cx="178" cy="372" r="44" fill="${WHITE}"/>
  <circle cx="178" cy="372" r="18" fill="${NAVY}"/>
  <circle cx="352" cy="134" r="30" fill="${AMBER}"/>`;

const scaled = (s) => `<g transform="translate(256 256) scale(${s}) translate(-256 -256)">${MARK}</g>`;
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${inner}</svg>\n`;

const ROUNDED = svg(`<rect width="512" height="512" rx="112" fill="${NAVY}"/>${MARK}`);
// Full-bleed squares: Android masks them to its own shape, iOS rounds the corners itself.
// The mark is shrunk to stay inside the maskable safe zone (the middle 80%).
const MASKABLE = svg(`<rect width="512" height="512" fill="${NAVY}"/>${scaled(0.8)}`);
const APPLE = svg(`<rect width="512" height="512" fill="${NAVY}"/>${scaled(0.9)}`);
// For dark surfaces such as the app header: no background.
const MARK_ONLY = svg(scaled(1.12));

const PNGS = [
  ["icon-512.png", ROUNDED, 512],
  ["icon-192.png", ROUNDED, 192],
  ["maskable-512.png", MASKABLE, 512],
  ["apple-touch-icon.png", APPLE, 180],
  ["favicon-32.png", ROUNDED, 32],
];

const dir = new URL("../public/icons/", import.meta.url);
await writeFile(new URL("atlas.svg", dir), ROUNDED);
await writeFile(new URL("atlas-mark.svg", dir), MARK_ONLY);

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
for (const [name, source, size] of PNGS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block}</style>
    <img src="data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}" width="${size}" height="${size}">`);
  await page.locator("img").evaluate((img) => img.decode());
  await writeFile(new URL(name, dir), await page.screenshot({ omitBackground: true }));
}
await browser.close();
console.log(`icons -> ${dir.pathname}`);
