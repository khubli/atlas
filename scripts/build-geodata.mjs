// Builds public/geo/places.json: a compact offline gazetteer for the in-browser
// reverse geocoder (city, state, country from coordinates).
// Source: GeoNames cities5000 + admin1 codes + country info, CC BY 4.0.
//   node scripts/build-geodata.mjs [outFile]

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { unzipSync, strFromU8 } from "fflate";

const BASE = "https://download.geonames.org/export/dump/";
const out = process.argv[2] || "public/geo/places.json";

async function fetchText(name) {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.text();
}

async function fetchZipEntry(name, entry) {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  return strFromU8(files[entry]);
}

const countries = new Map(); // ISO2 -> name
for (const line of (await fetchText("countryInfo.txt")).split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const f = line.split("\t");
  countries.set(f[0], f[4]);
}

const admin1 = new Map(); // "IN.19" -> "Karnataka"
for (const line of (await fetchText("admin1CodesASCII.txt")).split("\n")) {
  const f = line.split("\t");
  if (f.length >= 2) admin1.set(f[0], f[1]);
}

// Sections of a city (PPLX) and destroyed/abandoned places would fragment
// metros into suburbs, so only real populated places are kept.
const KEEP = new Set(["PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC", "PPLG", "PPLS", "PPLF", "PPLR"]);

const names = [], lat = [], lng = [], pop = [], a1 = [], cc = [];
const a1Index = new Map(), a1Names = [];
const ccIndex = new Map(), ccNames = [], ccCodes = [];

const cities = await fetchZipEntry("cities5000.zip", "cities5000.txt");
for (const line of cities.split("\n")) {
  const f = line.split("\t");
  if (f.length < 15 || !KEEP.has(f[7])) continue;
  const code = f[8];
  if (!ccIndex.has(code)) {
    ccIndex.set(code, ccNames.length);
    ccNames.push(countries.get(code) || code);
    ccCodes.push(code);
  }
  const a1Key = `${code}.${f[10]}`;
  if (!a1Index.has(a1Key)) {
    a1Index.set(a1Key, a1Names.length);
    a1Names.push(admin1.get(a1Key) || "");
  }
  names.push(f[2] || f[1]); // ASCII name: "Kankon", not "Kānkon"
  lat.push(Math.round(Number(f[4]) * 1e4));
  lng.push(Math.round(Number(f[5]) * 1e4));
  pop.push(Number(f[14]) || 0);
  a1.push(a1Index.get(a1Key));
  cc.push(ccIndex.get(code));
}

const data = {
  source: "GeoNames cities5000, admin1CodesASCII, countryInfo (https://www.geonames.org), CC BY 4.0",
  built: new Date().toISOString().slice(0, 10),
  countries: ccNames, countryCodes: ccCodes, admin1: a1Names,
  name: names, lat, lng, pop, a1, cc,
};
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(data));
console.log(`${names.length} places, ${a1Names.length} regions, ${ccNames.length} countries -> ${out}`);
