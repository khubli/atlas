// Writes the demo dataset the app's "Try demo data" button loads:
//   <dir>/timeline.json  fictional Android Timeline export
//   <dir>/places.json    what Google Places would say about its places
//   node scripts/make-demo.mjs public/demo

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { androidExport, buildSegments, placeDetails } from "../src/demo/generate.js";

const dir = process.argv[2] || "public/demo";
await mkdir(dir, { recursive: true });
const segments = buildSegments();
await writeFile(join(dir, "timeline.json"), JSON.stringify(androidExport(segments)));
await writeFile(join(dir, "places.json"), JSON.stringify(placeDetails()));
console.log(`demo: ${segments.length} segments -> ${dir}`);
