// Fictional timeline for the demo and the tests: a Bengaluru resident,
// 2019-2026, with 15 trips, a commute, weekend routine and family visits.
// Emits the same data in Android, iPhone or Takeout shape. No real person's data.

import data from "./data.json" with { type: "json" };
import { haversineKm } from "../engine/geo.js";
import { localIso } from "../engine/time.js";

const IST = 330;
const SGT = 480;
export const PLACES = {
  ...data.places,
  parents: {
    name: "Parents' home", types: [], address: "Kuvempunagar, Mysuru, Karnataka 570023, India",
    lat: 12.285, lng: 76.62, rating: null,
  },
};
export const TRIPS = data.trips;
const SINGAPORE = new Set(data.singapore);
const FAMILY_WEEKENDS = ["2020-08-15", "2021-03-13", "2022-12-24", "2023-06-17", "2025-05-10"];

const SPEED_KMH = { walk: 4.5, car: 45, train: 60, bus: 40, flight: 650 };
const ROAD_FACTOR = { walk: 1.2, car: 1.3, train: 1.25, bus: 1.3, flight: 1.0 };
const ACTIVITY_TYPE = { walk: "WALKING", car: "IN_PASSENGER_VEHICLE", train: "IN_TRAIN", bus: "IN_BUS", flight: "FLYING" };
const MIN = 60000;

export const placeId = (key) => (key === "home" ? "demoHomeAAAAAAAAAAA" : `ChIJdemo_${key}`);
const tzOf = (key) => (SINGAPORE.has(key) ? SGT : IST);

function rng(seed) {
  // mulberry32
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    random: next,
    uniform: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    sample: (xs, n) => {
      const pool = [...xs];
      const out = [];
      while (out.length < n && pool.length) out.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
      return out;
    },
  };
}

const ts = (ms, offset) => {
  const s = localIso(ms, offset);
  return `${s.slice(0, 19)}.000${s.slice(19)}`;
};
const latLng = (lat, lng, mangle) => {
  const deg = mangle ? "Â°" : "°";
  return `${lat.toFixed(7)}${deg}, ${lng.toFixed(7)}${deg}`;
};

/** Wall-clock ms for a local date + "HH:MM" at an offset. */
const at = (date, hhmm, offset = IST) => Date.parse(`${date}T${hhmm}:00Z`) - offset * MIN;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

class Builder {
  constructor(r) {
    this.r = r;
    this.segments = [];
    this.loc = "home";
    this.t = null;
  }

  visit(key, start, end, level = 0) {
    const p = PLACES[key];
    const tz = tzOf(key);
    this.segments.push({
      startTime: ts(start, tz),
      endTime: ts(end, tz),
      startTimeTimezoneUtcOffsetMinutes: tz,
      endTimeTimezoneUtcOffsetMinutes: tz,
      visit: {
        hierarchyLevel: level,
        probability: Math.round(this.r.uniform(0.6, 0.98) * 1000) / 1000,
        topCandidate: {
          placeId: placeId(key),
          semanticType: key === "home" ? "HOME" : key === "work" ? "WORK" : "UNKNOWN",
          probability: Math.round(this.r.uniform(0.5, 0.95) * 1000) / 1000,
          placeLocation: { latLng: latLng(p.lat, p.lng, this.r.random() < 0.3) },
        },
      },
    });
  }

  move(a, b, mode) {
    const pa = PLACES[a];
    const pb = PLACES[b];
    let km = haversineKm(pa.lat, pa.lng, pb.lat, pb.lng) * ROAD_FACTOR[mode];
    if (km < 0.2) return;
    if (mode === "car" && km < 2) {
      mode = "walk";
      km = haversineKm(pa.lat, pa.lng, pb.lat, pb.lng) * ROAD_FACTOR.walk;
    }
    const minutes = (km / SPEED_KMH[mode]) * 60 + (mode === "flight" ? 45 : 5);
    const start = this.t;
    const end = start + minutes * MIN;
    const tzA = tzOf(a);
    this.segments.push({
      startTime: ts(start, tzA),
      endTime: ts(end, tzOf(b)),
      activity: {
        start: { latLng: latLng(pa.lat, pa.lng) },
        end: { latLng: latLng(pb.lat, pb.lng) },
        distanceMeters: Math.round(km * 10000) / 10,
        topCandidate: { type: ACTIVITY_TYPE[mode], probability: 0.9 },
      },
    });
    if (["car", "train", "bus"].includes(mode) && km > 5) {
      const steps = Math.max(2, Math.min(60, Math.floor(km / 4)));
      const bend = this.r.uniform(-0.08, 0.08);
      const points = [];
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        const wobble = bend * f * (1 - f) * 4;
        const lat = pa.lat + (pb.lat - pa.lat) * f + wobble * (pb.lng - pa.lng) * 0.3;
        const lng = pa.lng + (pb.lng - pa.lng) * f - wobble * (pb.lat - pa.lat) * 0.3;
        points.push({ point: latLng(lat, lng), time: ts(start + (end - start) * f, tzA) });
      }
      this.segments.push({ startTime: ts(start, tzA), endTime: ts(end, tzA), timelinePath: points });
    }
    this.t = end;
  }

  go(key, minutes, mode = "car") {
    this.move(this.loc, key, mode);
    const start = this.t;
    this.t = start + minutes * MIN;
    this.visit(key, start, this.t);
    this.loc = key;
  }

  stayUntil(key, until, mode = "car") {
    const last = this.segments[this.segments.length - 1];
    if (this.loc === key && last?.visit?.topCandidate.placeId === placeId(key)) {
      this.t = Math.max(until, this.t);
      last.endTime = ts(this.t, tzOf(key));
      return;
    }
    this.move(this.loc, key, mode);
    const start = this.t;
    this.t = Math.max(until, start + 10 * MIN);
    this.visit(key, start, this.t);
    this.loc = key;
  }

  nested(key, offsetMin, minutes) {
    const parent = [...this.segments].reverse().find((s) => s.visit);
    const pStart = Date.parse(parent.startTime);
    const pEnd = Date.parse(parent.endTime);
    const start = Math.min(pStart + offsetMin * MIN, pEnd);
    this.visit(key, start, Math.min(start + minutes * MIN, pEnd), 1);
  }
}

function routineDay(b, day, r) {
  b.stayUntil("home", at(day, `${String(r.int(8, 9)).padStart(2, "0")}:${r.pick(["05", "20", "40"])}`));
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  if (weekday < 5) {
    b.go("work", r.int(500, 560));
    if (r.random() < 0.25) b.go(r.pick(["cafe", "toit", "gym"]), r.int(40, 100));
  } else {
    for (const key of r.sample(["cafe", "grocery", "gym", "cubbon", "lalbagh", "toit", "mall", "mtr"], r.int(1, 3))) {
      b.go(key, r.int(45, 150));
      if (key === "mall" && r.random() < 0.6) b.nested("pvr", 30, 150);
    }
  }
  b.stayUntil("home", at(addDays(day, 1), "00:00"));
}

function familyWeekend(b, day, r) {
  b.stayUntil("home", at(day, "08:30"));
  b.go("parents", r.int(400, 600));
  b.stayUntil("parents", at(addDays(day, 1), "16:00"));
  b.go("home", 60);
  return addDays(day, 2);
}

function trip(b, t, r) {
  const day0 = t.start;
  b.stayUntil("home", at(day0, t.leave));
  t.days.forEach((items, i) => {
    const day = addDays(day0, i);
    if (i > 0) b.stayUntil(t.stays[i - 1], at(day, "08:30", tzOf(t.stays[i - 1])), t.mode);
    for (const [key, minutes, mode] of items) b.go(key, minutes + r.int(-10, 15), mode ?? t.mode);
    if (i >= t.stays.length) b.go("home", 60, "car");
  });
  return addDays(day0, t.days.length);
}

/** The demo timeline as Android on-device segments (the canonical shape). */
export function buildSegments({ start = "2019-01-01", end = "2026-09-30", seed = 11 } = {}) {
  const r = rng(seed);
  const b = new Builder(r);
  b.t = at(start, "00:00");
  const trips = new Map(TRIPS.map((t) => [t.start, t]));
  const family = new Set(FAMILY_WEEKENDS);
  let day = start;
  while (day <= end) {
    if (trips.has(day)) day = trip(b, trips.get(day), r);
    else if (family.has(day)) day = familyWeekend(b, day, r);
    else {
      routineDay(b, day, r);
      day = addDays(day, 1);
    }
  }
  return b.segments;
}

// ---- export shapes ---------------------------------------------------------------------

export function androidExport(segments) {
  return {
    semanticSegments: segments,
    rawSignals: [
      { position: { LatLng: "12.9719°, 77.6411°", accuracyMeters: 13, timestamp: segments[0]?.startTime } },
      { wifiScan: { deliveryTime: segments[0]?.startTime, devicesRecords: [{ mac: 70474800562644, rawRssi: -54 }] } },
    ],
    userLocationProfile: {
      frequentPlaces: [
        { placeId: placeId("home"), placeLocation: "12.9719°, 77.6411°", label: "HOME" },
        { placeId: placeId("work"), placeLocation: "12.9698°, 77.7499°", label: "WORK" },
      ],
    },
  };
}

const geo = (latLngStr) => {
  const [lat, lng] = latLngStr.replace(/Â/g, "").replace(/°/g, "").split(",").map((s) => Number(s.trim()));
  return `geo:${lat},${lng}`;
};
const iosSemantic = { HOME: "Home", WORK: "Work", UNKNOWN: "Unknown" };
const iosActivity = { WALKING: "walking", IN_PASSENGER_VEHICLE: "in passenger vehicle", IN_TRAIN: "in train", IN_BUS: "in bus", FLYING: "flying" };

/** The iPhone spelling: bare array, placeID, geo: strings, numbers as strings. */
export function iosExport(segments) {
  return segments.map((s) => {
    const out = { startTime: s.startTime, endTime: s.endTime };
    if (s.visit) {
      const tc = s.visit.topCandidate;
      out.visit = {
        hierarchyLevel: String(s.visit.hierarchyLevel),
        probability: String(s.visit.probability),
        topCandidate: {
          probability: String(tc.probability),
          semanticType: iosSemantic[tc.semanticType] ?? tc.semanticType,
          placeID: tc.placeId,
          placeLocation: geo(tc.placeLocation.latLng),
        },
      };
    }
    if (s.activity) {
      out.activity = {
        start: geo(s.activity.start.latLng),
        end: geo(s.activity.end.latLng),
        distanceMeters: String(s.activity.distanceMeters),
        topCandidate: { type: iosActivity[s.activity.topCandidate.type], probability: "0.9" },
      };
    }
    if (s.timelinePath) {
      const t0 = Date.parse(s.startTime);
      out.timelinePath = s.timelinePath.map((p) => ({
        point: geo(p.point),
        durationMinutesOffsetFromStartTime: String(Math.round((Date.parse(p.time) - t0) / MIN)),
      }));
    }
    return out;
  });
}

/** Legacy Takeout monthly files { "2019_DECEMBER.json": { timelineObjects } } with names and addresses. */
export function takeoutExport(segments) {
  const months = {};
  const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  const e7 = (v) => Math.round(v * 1e7);
  const keyOf = Object.fromEntries(Object.keys(PLACES).map((k) => [placeId(k), k]));
  for (const s of segments) {
    if (!s.visit && !s.activity) continue;
    const d = new Date(Date.parse(s.startTime));
    const file = `${d.getUTCFullYear()}_${MONTHS[d.getUTCMonth()]}.json`;
    months[file] ??= { timelineObjects: [] };
    const duration = { startTimestamp: new Date(Date.parse(s.startTime)).toISOString(), endTimestamp: new Date(Date.parse(s.endTime)).toISOString() };
    if (s.visit && s.visit.hierarchyLevel === 0) {
      const tc = s.visit.topCandidate;
      const p = PLACES[keyOf[tc.placeId]];
      months[file].timelineObjects.push({
        placeVisit: {
          location: {
            latitudeE7: e7(p.lat), longitudeE7: e7(p.lng), placeId: tc.placeId, name: p.name, address: p.address,
            semanticType: tc.semanticType === "UNKNOWN" ? undefined : `TYPE_${tc.semanticType}`,
          },
          duration, visitConfidence: 85,
        },
      });
    } else if (s.activity) {
      const [la, lo] = s.activity.start.latLng.replace(/[Â°]/g, "").split(",").map(Number);
      const [lb, lob] = s.activity.end.latLng.replace(/[Â°]/g, "").split(",").map(Number);
      months[file].timelineObjects.push({
        activitySegment: {
          startLocation: { latitudeE7: e7(la), longitudeE7: e7(lo) },
          endLocation: { latitudeE7: e7(lb), longitudeE7: e7(lob) },
          duration, distance: Math.round(s.activity.distanceMeters), activityType: s.activity.topCandidate.type,
        },
      });
    }
  }
  return months;
}

/** What Google Places would answer for each demo place (the demo's enrichment cache). */
export function placeDetails() {
  const out = {};
  for (const [key, p] of Object.entries(PLACES)) {
    if (!p.name || key === "home" || key === "work" || key === "parents") continue;
    out[placeId(key)] = {
      name: p.name,
      types: [...p.types, "point_of_interest", "establishment"],
      address: p.address,
      uri: `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`,
      rating: p.rating,
      ratingCount: 1000 + ((key.length * 7919) % 90000),
    };
  }
  return out;
}
