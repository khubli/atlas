import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Atlas } from "../../src/engine/atlas.js";
import { readSegment } from "../../src/engine/formats/segments.js";
import { Geocoder } from "../../src/engine/geocode.js";
import { Batch, Dataset } from "../../src/engine/ingest.js";

export const HOME = [12.97194, 77.64115]; // Bengaluru
export const WORK = [12.9698, 77.7499]; // 12 km away
export const JAIPUR = [26.9855, 75.8513];
export const MYSURU = [12.3052, 76.6552];
export const UDAIPUR = [24.5764, 73.6835];
export const AIRPORT = [13.19864, 77.7066]; // 26 km: near home, not a base

let geocoder;
export function getGeocoder() {
  geocoder ??= new Geocoder(JSON.parse(readFileSync(fileURLToPath(new URL("../../public/geo/places.json", import.meta.url)), "utf8")));
  return geocoder;
}

/** "2023-01-05", "05:00" -> ISO string at +05:30. */
export const at = (day, hhmm = "00:00") => `${day}T${hhmm}:00.000+05:30`;

/** Android-shaped segments for hand-written scenarios. */
export class Timeline {
  constructor() {
    this.segments = [];
  }
  visit(placeId, start, end, latlng, semantic = "UNKNOWN", level = 0) {
    this.segments.push({
      startTime: start,
      endTime: end,
      visit: {
        hierarchyLevel: level,
        probability: 0.9,
        topCandidate: { placeId, semanticType: semantic, placeLocation: { latLng: `${latlng[0]}°, ${latlng[1]}°` } },
      },
    });
    return this;
  }
  home(start, end) {
    return this.visit("home", start, end, HOME, "HOME");
  }
  work(start, end) {
    return this.visit("work", start, end, WORK, "WORK");
  }
  activity(start, end, a, b, km, type = "IN_PASSENGER_VEHICLE") {
    this.segments.push({
      startTime: start,
      endTime: end,
      activity: {
        start: { latLng: `${a[0]}°, ${a[1]}°` },
        end: { latLng: `${b[0]}°, ${b[1]}°` },
        distanceMeters: km * 1000,
        topCandidate: { type },
      },
    });
    return this;
  }
  dataset() {
    const batch = new Batch();
    for (const s of this.segments) readSegment(s, batch, 330);
    const ds = new Dataset();
    ds.merge(batch);
    return ds;
  }
  atlas(opts = {}) {
    return new Atlas({ dataset: this.dataset(), geocoder: getGeocoder(), ...opts });
  }
}

/** Several HOME visits so the home anchor qualifies (needs >= 3 HOME-tagged visits). */
export function settledHome(tl, firstDay = "2023-01-01") {
  for (let d = 0; d < 3; d++) {
    const day = new Date(Date.parse(`${firstDay}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
    tl.home(at(day, "00:00"), at(day, "08:00"));
  }
  return tl;
}
