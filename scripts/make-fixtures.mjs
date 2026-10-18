// Writes the files the end-to-end tests import (all fictional, from the demo traveller):
//   android-2019.json   Android export, Jun 2019 - Jan 2020
//   android-2020.json   a newer Android export of the same phone, Jun 2019 - Dec 2020
//   ios-2019.json       the iPhone spelling of android-2019.json
//   takeout-2019.zip    legacy Takeout monthly files for the same months
//   Saved Places.json   Google Maps saved places (Takeout), one starred sight
//   Records.json        the old raw Location History file Atlas can't use
//   big-android.json    ~100 MB Android export with raw signals (only with --scale)
//   node scripts/make-fixtures.mjs tests/e2e/.fixtures [--scale]

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { androidExport, buildSegments, iosExport, PLACES, takeoutExport } from "../src/demo/generate.js";

const dir = process.argv[2] || "tests/e2e/.fixtures";
const scale = process.argv.includes("--scale");
await mkdir(dir, { recursive: true });

const y2019 = buildSegments({ start: "2019-06-01", end: "2020-01-31" });
const y2020 = buildSegments({ start: "2019-06-01", end: "2020-12-31" });
const write = (name, data) => writeFile(join(dir, name), typeof data === "string" || data instanceof Uint8Array ? data : JSON.stringify(data));

await write("android-2019.json", androidExport(y2019));
await write("android-2020.json", androidExport(y2020));
await write("ios-2019.json", iosExport(y2019));
const months = takeoutExport(y2019);
await write("takeout-2019.zip", zipSync(Object.fromEntries(Object.entries(months).map(([file, body]) =>
  [`Takeout/Location History (Timeline)/Semantic Location History/${file.slice(0, 4)}/${file}`, strToU8(JSON.stringify(body))]))));
// Google Maps saved places (Takeout "Maps (your places)"): one starred sight.
const hawa = PLACES.hawa_mahal;
await write("Saved Places.json", {
  type: "FeatureCollection",
  features: [{ type: "Feature", geometry: { type: "Point", coordinates: [hawa.lng, hawa.lat] },
    properties: { google_maps_url: "http://maps.google.com/?cid=1", location: { name: "Palace of the Winds (saved)", address: "Jaipur" } } }],
});
await write("Records.json", { locations: [{ latitudeE7: 129719000, longitudeE7: 776411000, timestamp: "2019-06-01T08:00:00Z" }] });

if (scale) {
  // The full demo history plus a dense raw GPS trail, about the size of a long real export.
  const data = androidExport(buildSegments());
  const t0 = Date.parse("2019-01-01T00:00:00Z");
  data.rawSignals = Array.from({ length: 640_000 }, (_, i) => ({
    position: {
      LatLng: `${(12.9 + (i % 997) * 1e-4).toFixed(7)}°, ${(77.5 + (i % 991) * 1e-4).toFixed(7)}°`,
      accuracyMeters: 10 + (i % 30), altitudeMeters: 900, source: "WIFI",
      timestamp: new Date(t0 + i * 380_000).toISOString(),
    },
  }));
  await write("big-android.json", data);
}
console.log(`fixtures -> ${dir}${scale ? " (with big-android.json)" : ""}`);
