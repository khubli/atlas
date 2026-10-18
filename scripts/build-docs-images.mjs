// Draws the images the docs use: the "how it works" overview (light and dark) and the
// 1280x640 social preview. Edit the HTML below when stage names change, then run:
//   node scripts/build-docs-images.mjs   (PW_CHROMIUM=... if Playwright's browser isn't installed)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const root = new URL("../", import.meta.url);
const logo = (await readFile(new URL("public/icons/atlas.svg", root))).toString("base64");
const LOGO = `data:image/svg+xml;base64,${logo}`;
const FONT = `font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;`;

const THEMES = {
  light: { bg: "#ffffff", panel: "#f4f6f8", card: "#ffffff", line: "#d9e0e6", ink: "#14202b", ink2: "#4f5d6b", brand: "#0b7d72", wash: "#e3f5f2", amber: "#a86a00" },
  dark: { bg: "#0d1117", panel: "#151d24", card: "#1b252e", line: "#2a3640", ink: "#e8eef3", ink2: "#b3c0cb", brand: "#4fd1c1", wash: "#123330", amber: "#f2b33d" },
};

const STAGES = [
  ["Read", "Android, iPhone and old Takeout exports; big files streamed; merged with earlier imports"],
  ["Homes and work", "Home from where you sleep, month by month; work from long weekdays"],
  ["Name places", "You, your saved places, OpenStreetMap; offline city and country"],
  ["Trips and everyday", "Trips by your rules, from the home of the time; commutes and routines"],
];

function overview(t) {
  const arrow = `<div class="arrow">→</div>`;
  return `<!doctype html><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    body { ${FONT} background: ${t.bg}; color: ${t.ink}; width: 1400px; padding: 40px; }
    .row { display: flex; align-items: stretch; gap: 14px; }
    .box { border: 1.5px solid ${t.line}; border-radius: 16px; background: ${t.card}; padding: 18px; }
    .label { font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: ${t.ink2}; margin-bottom: 12px; }
    h3 { font-size: 19px; margin-bottom: 6px; }
    p { font-size: 15px; line-height: 1.4; color: ${t.ink2}; }
    .arrow { align-self: center; font-size: 26px; color: ${t.ink2}; }
    .device { flex: 1; background: ${t.panel}; border: 1.5px dashed ${t.brand}; border-radius: 20px; padding: 18px; }
    .device > .label { color: ${t.brand}; }
    .stages { display: flex; gap: 10px; align-items: stretch; }
    .stage { flex: 1; position: relative; padding-top: 34px; }
    .num { position: absolute; top: 14px; left: 18px; font-size: 13px; font-weight: 700; color: ${t.brand}; }
    .store { margin-top: 12px; display: flex; gap: 10px; }
    .store .box { flex: 1; padding: 12px 16px; background: ${t.wash}; border-color: transparent; }
    .store h3 { font-size: 16px; margin: 0; }
    .side { width: 200px; }
    .opt { margin-top: 18px; display: flex; gap: 12px; align-items: center; }
    .opt .box { flex: 1; padding: 12px 16px; border-style: dashed; }
    .opt h3 { font-size: 15px; margin: 0 0 2px; }
    .opt p { font-size: 13px; }
    .title { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
    .title img { width: 40px; height: 40px; }
    .title strong { font-size: 24px; }
    .title span { font-size: 17px; color: ${t.ink2}; }
  </style>
  <div class="title"><img src="${LOGO}"><strong>Atlas</strong><span>How your Timeline becomes your travels</span></div>
  <div class="row">
    <div class="box side"><div class="label">On your phone</div><h3>Timeline export</h3>
      <p>From the phone's Timeline settings. Optional: your saved places from Google Takeout.</p></div>
    ${arrow}
    <div class="device"><div class="label">In your browser · nothing is uploaded</div>
      <div class="stages">${STAGES.map(([h, p], i) => `${i ? arrow : ""}<div class="box stage"><span class="num">${i + 1}</span><h3>${h}</h3><p>${p}</p></div>`).join("")}</div>
      <div class="store">
        <div class="box"><h3>Stored on this device (IndexedDB)</h3><p>History, labels, trip edits, settings. Backup file to move devices.</p></div>
        <div class="box"><h3>Works offline, installs as an app</h3><p>Service worker; share the export straight to Atlas.</p></div>
      </div>
    </div>
    ${arrow}
    <div class="box side"><div class="label">You see</div><h3>Overview, Trips, Everyday, Map, Places</h3>
      <p>Every label shows where it came from; your edits always win.</p></div>
  </div>
  <div class="opt">
    <div class="label" style="margin:0;width:200px">Network, optional</div>
    <div class="box"><h3>Map tiles</h3><p>OpenStreetMap sees the map areas you view</p></div>
    <div class="box"><h3>Place names</h3><p>OpenStreetMap Overpass gets place coordinates; can be turned off</p></div>
    <div class="box"><h3>Google Places</h3><p>Only with your own key; gets place IDs</p></div>
  </div>`;
}

function social() {
  const t = THEMES.dark;
  return `<!doctype html><meta charset="utf-8"><style>
    * { margin: 0; box-sizing: border-box; }
    body { ${FONT} width: 1280px; height: 640px; overflow: hidden; color: ${t.ink};
      background: radial-gradient(circle at 85% 20%, #1d3145 0, #13202e 55%, #0e1419 100%); padding: 84px 92px; }
    img.logo { width: 120px; height: 120px; }
    h1 { font-size: 88px; letter-spacing: -.02em; margin-top: 34px; }
    p { font-size: 34px; color: ${t.ink2}; margin-top: 14px; max-width: 900px; line-height: 1.3; }
    .foot { position: absolute; bottom: 70px; left: 92px; font-size: 24px; color: ${t.brand}; }
  </style>
  <img class="logo" src="${LOGO}">
  <h1>Atlas</h1>
  <p>Your travel history, rebuilt from your own Google Timeline, on your device.</p>
  <div class="foot">Open source · no account · nothing uploaded</div>`;
}

await mkdir(new URL("docs/images/", root), { recursive: true });
await mkdir(new URL("docs/brand/", root), { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
for (const [name, t] of Object.entries(THEMES)) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 400 }, deviceScaleFactor: 1.5 });
  await page.setContent(overview(t));
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await writeFile(new URL(`docs/images/how-it-works-${name}.png`, root), await page.screenshot({ fullPage: true }));
  await page.close();
}
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
await page.setContent(social());
await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
await writeFile(new URL("docs/brand/social-preview.png", root), await page.screenshot());
await browser.close();
console.log("docs images -> docs/images, docs/brand");
