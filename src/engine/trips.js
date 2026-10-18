// Trips: runs of visits away from home, under a "lens" the user controls.
//
// A stop is away when it is farther than `awayKm` from where home was at the
// time and is not a base (home; work and family homes if the lens says so).
// Departure is when the last base visit before the run ended, return is when
// the next one began (within `edgeHours`, never walking past another trip's
// away stop). Runs separated by a short interlude that never touches a base
// (a layover at the home airport) merge.

import { haversineKm, simplifySegments, splitTrack } from "./geo.js";
import { daysBetween, HOUR, localDate, localMinuteId } from "./time.js";

export const DEFAULT_LENS = {
  awayKm: 50,
  workIsBase: true,
  familyIsBase: false,
  minHours: 3,
  mergeGapHours: 12,
  maxGapHours: 72,
  maxDays: 45,
  edgeHours: 24,
};

export function isBase(place, lens) {
  if (!place) return false;
  return place.kind === "home" || (lens.workIsBase && place.kind === "work") || (lens.familyIsBase && place.kind === "family");
}

function buildStops(ds, places, home, lens) {
  const stops = [];
  for (const v of ds.top) {
    const p = places.get(v.placeId);
    if (!p || p.lat == null) continue;
    const h = home.at(v.start);
    const distanceKm = h ? haversineKm(p.lat, p.lng, h.lat, h.lng) : null;
    const base = isBase(p, lens);
    stops.push({ v, p, base, home: h, distanceKm, away: !base && distanceKm != null && distanceKm > lens.awayKm });
  }
  return stops;
}

function findRuns(stops, lens) {
  const maxGap = lens.maxGapHours * HOUR;
  const runs = [];
  let current = [];
  for (const s of stops) {
    if (s.away) {
      if (current.length && s.v.start - current[current.length - 1].v.end > maxGap) {
        runs.push(current);
        current = [];
      }
      current.push(s);
    } else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

function bounds(run, stops, indexOf, lens) {
  const edge = lens.edgeHours * HOUR;
  const first = run[0];
  const last = run[run.length - 1];
  let departure = { ms: first.v.start, offset: first.v.offset };
  for (let i = indexOf.get(first) - 1; i >= 0; i--) {
    const s = stops[i];
    if (s.away || s.v.end < first.v.start - edge) break;
    if (s.base) {
      departure = { ms: Math.min(s.v.end, first.v.start), offset: s.v.offset };
      break;
    }
  }
  let ret = { ms: last.v.end, offset: last.v.offset };
  for (let j = indexOf.get(last) + 1; j < stops.length; j++) {
    const s = stops[j];
    if (s.away || s.v.start > last.v.end + edge) break;
    if (s.base) {
      ret = { ms: Math.max(s.v.start, last.v.end), offset: s.v.offset };
      break;
    }
  }
  return [departure, ret];
}

/** Detect trips. Returns trips without heavy fields (path is computed on demand). */
export function detectTrips(ds, places, home, lensInput = {}) {
  const lens = { ...DEFAULT_LENS, ...lensInput };
  const stops = buildStops(ds, places, home, lens);
  const indexOf = new Map(stops.map((s, i) => [s, i]));
  const runs = findRuns(stops, lens);

  const merged = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const gapStart = prev[prev.length - 1].v.end;
      const gapEnd = run[0].v.start;
      const touchesBase = stops.some((s) => s.base && s.v.start >= gapStart && s.v.start < gapEnd);
      if (gapEnd - gapStart <= lens.mergeGapHours * HOUR && !touchesBase) {
        prev.push(...run);
        continue;
      }
    }
    merged.push([...run]);
  }

  const trips = [];
  for (const run of merged) {
    const [dep, ret] = bounds(run, stops, indexOf, lens);
    const hours = (ret.ms - dep.ms) / HOUR;
    if (hours < lens.minHours || hours > lens.maxDays * 24) continue;
    trips.push(summarize(run, dep, ret, ds));
  }
  return trips;
}

const ranked = (weights) => [...weights.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));

function title(cities, states, countries, run, startDate) {
  const names = cities.slice(0, 3).map(([c]) => c);
  if (names.length === 1) return names[0];
  if (names.length > 1) return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  if (states.length) return states[0][0];
  if (countries.length) return countries[0][0];
  const named = run.find((s) => s.p.name);
  return named ? named.p.name : `Trip on ${startDate}`;
}

function windowed(list, start, end) {
  // list sorted by .start
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start < start) lo = mid + 1;
    else hi = mid;
  }
  const out = [];
  for (let i = lo; i < list.length && list[i].start < end; i++) out.push(list[i]);
  return out;
}

function summarize(run, dep, ret, ds) {
  const cityW = new Map();
  const cityState = new Map();
  const stateW = new Map();
  const countryW = new Map();
  let totalW = 0;
  let cLat = 0;
  let cLng = 0;
  for (const s of run) {
    const m = Math.max((s.v.end - s.v.start) / 60000, 1);
    if (s.p.city) {
      cityW.set(s.p.city, (cityW.get(s.p.city) || 0) + m);
      if (s.p.state && !cityState.has(s.p.city)) cityState.set(s.p.city, s.p.state);
    }
    if (s.p.state) stateW.set(s.p.state, (stateW.get(s.p.state) || 0) + m);
    if (s.p.country) countryW.set(s.p.country, (countryW.get(s.p.country) || 0) + m);
    totalW += m;
    cLat += s.p.lat * m;
    cLng += s.p.lng * m;
  }
  const cities = ranked(cityW);
  const states = ranked(stateW);
  const countries = ranked(countryW);

  const moves = windowed(ds.moves, dep.ms, ret.ms);
  const transport = {};
  let distance = 0;
  for (const mv of moves) {
    distance += mv.km;
    transport[mv.mode] = (transport[mv.mode] || 0) + mv.km;
  }
  if (distance === 0) {
    // No movement records: home -> stops -> home as the crow flies.
    const chain = [run[0].home, ...run.map((s) => s.p), run[run.length - 1].home].filter(Boolean);
    for (let i = 1; i < chain.length; i++) distance += haversineKm(chain[i - 1].lat, chain[i - 1].lng, chain[i].lat, chain[i].lng) || 0;
  }
  const visits = windowed(ds.visits, dep.ms, ret.ms);
  const startDate = localDate(dep.ms, dep.offset);
  const endDate = localDate(ret.ms, ret.offset);
  const nights = Math.max(0, daysBetween(startDate, endDate));
  const home = run[0].home;
  const round1 = (x) => Math.round(x * 10) / 10;
  // A small route sketch for trip cards: home, the stops in order, home again.
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const sketch = [];
  for (const pt of [home, ...run.map((st) => st.p), run[run.length - 1].home]) {
    if (pt?.lat == null) continue;
    const last = sketch[sketch.length - 1];
    if (!last || last[0] !== r3(pt.lat) || last[1] !== r3(pt.lng)) sketch.push([r3(pt.lat), r3(pt.lng)]);
  }
  const step = Math.ceil(sketch.length / 40);
  const route = step > 1 ? sketch.filter((_, i) => i % step === 0 || i === sketch.length - 1) : sketch;

  return {
    id: localMinuteId(dep.ms, dep.offset),
    start: dep.ms,
    end: ret.ms,
    startOffset: dep.offset,
    endOffset: ret.offset,
    start_date: startDate,
    end_date: endDate,
    nights,
    kind: nights === 0 ? "day_trip" : "overnight",
    title: title(cities, states, countries, run, startDate),
    route,
    primary_city: cities[0]?.[0] ?? null,
    primary_state: states[0]?.[0] ?? null,
    primary_country: countries[0]?.[0] ?? null,
    cities: cities.slice(0, 12).map(([city, m]) => ({ city, state: cityState.get(city) ?? null, minutes: Math.round(m) })),
    states: states.map(([s]) => s),
    countries: countries.map(([c]) => c),
    max_distance_km: round1(Math.max(...run.map((s) => s.distanceKm))),
    distance_km: round1(distance),
    transport: Object.fromEntries(Object.entries(transport).filter(([, km]) => km >= 0.05).map(([k, v]) => [k, round1(v)])),
    visit_count: visits.length,
    place_count: new Set(visits.map((v) => v.placeId)).size,
    center_lat: Math.round((cLat / totalW) * 1e5) / 1e5,
    center_lng: Math.round((cLng / totalW) * 1e5) / 1e5,
    home_lat: home?.lat ?? null,
    home_lng: home?.lng ?? null,
  };
}

/** GPS track for a trip: [[[lat, lng], ...], ...] segments, simplified. */
export function tripPath(ds, trip, maxPoints = 400) {
  return simplifySegments(splitTrack(ds.pointsBetween(trip.start, trip.end)), maxPoints);
}

export { windowed };
