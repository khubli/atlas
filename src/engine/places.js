// Resolves every visited place into what the app shows: name, category,
// theme, kind and geography, each with the source it came from.
//
// Precedence, highest first:
//   you (labels)  >  your Google Maps saved/labelled places  >  Google Places  >  Timeline
//   >  OpenStreetMap  >  visit patterns
// Geography: your labels > the offline geocoder (deterministic, no network).

import { categoryFromOsm, categoryFromTypes, themeFor } from "./classify.js";
import { haversineKm } from "./geo.js";
import { detectHomeAndWork } from "./homes.js";
import { localDate, localHour, weekKey, DAY, HOUR } from "./time.js";

export const KINDS = ["home", "work", "family", "everyday", "explored"];

const HOME_SEMANTICS = new Set(["HOME", "INFERRED_HOME"]);
const WORK_SEMANTICS = new Set(["WORK", "INFERRED_WORK"]);

export const DEFAULT_RULES = {
  minLabelVisits: 3, // HOME/WORK-tagged visits before Google's label counts (when behaviour is silent)
  familyNights: 4, // overnight stays (across >= familyMonths months) that make a place home-like
  familyMonths: 3,
  everydayWeeks: 4, // distinct weeks of visits near home that make a place everyday
};

/** The nights a visit covers: each 3 a.m. (local) inside a stay of a few hours or more. */
function nightsOf(v) {
  if (v.end - v.start < 3 * HOUR) return [];
  const off = v.offset * 60000;
  let t = Math.floor((v.start + off) / DAY) * DAY + 3 * HOUR;
  if (t < v.start + off) t += DAY;
  const out = [];
  for (; t <= v.end + off && out.length < 400; t += DAY) out.push(t - off);
  return out;
}
const isOvernight = (v) => nightsOf(v).length > 0;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** A long weekday daytime stay: a working day, as far as visits can tell. */
function isWorkday(v) {
  if (v.end - v.start < 4 * HOUR || isOvernight(v)) return false;
  const day = new Date(v.start + v.offset * 60000).getUTCDay();
  const hour = localHour(v.start, v.offset);
  return day >= 1 && day <= 5 && hour >= 5 && hour <= 15;
}

/** Where home was at a moment: the home that held the month, carried forward. */
export class HomeLocator {
  constructor(anchors) {
    this.anchors = anchors; // [{ start, lat, lng, placeId }] sorted
  }
  static from(anchors, places, topVisits) {
    if (anchors.length) return new HomeLocator(anchors);
    // No home at all: the place with the most time spent stands in.
    let best = null;
    for (const p of places.values()) if (p.lat != null && (!best || p.minutes > best.minutes)) best = p;
    return new HomeLocator(best && topVisits.length
      ? [{ start: topVisits[0].start, lat: best.lat, lng: best.lng, placeId: best.placeId, guessed: true }] : []);
  }
  at(t) {
    const a = this.anchors;
    if (!a.length) return null;
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid].start <= t) lo = mid + 1;
      else hi = mid;
    }
    return a[Math.max(lo - 1, 0)];
  }
  /** Homes over time: [{ placeId, from, to }]. */
  periods() {
    const out = [];
    for (const a of this.anchors) {
      const last = out[out.length - 1];
      if (last && last.placeId === a.placeId) last.to = a.end ?? a.start;
      else out.push({ placeId: a.placeId, from: a.start, to: a.end ?? a.start, guessed: Boolean(a.guessed) });
    }
    return out;
  }
}

/**
 * @param ds       Dataset
 * @param ctx      { labels, google, osm, geocoder, awayKm, cityAliases, rules }
 * @returns { places: Map<placeId, Place>, home: HomeLocator }
 */
export function resolvePlaces(ds, ctx) {
  const { labels = {}, google = {}, osm = {}, saved = [], geocoder, awayKm = 50, cityAliases = {} } = ctx;
  const rules = { ...DEFAULT_RULES, ...(ctx.rules || {}) };
  const places = new Map();

  // 1. Facts from the timeline. A place's own visits are its top-level ones;
  // places only ever seen nested (a cinema inside a mall) use their nested visits.
  for (const [placeId, visits] of ds.byPlace) {
    const own = ownVisits(visits);
    const p = {
      placeId, lat: null, lng: null, visits: 0, topVisits: 0, minutes: 0,
      semantic: {}, timelineName: null, timelineAddress: null,
      first: Infinity, last: -Infinity, weeks: new Set(), nightMonths: new Set(), nights: 0,
      nightList: [], workDays: new Set(), tags: { home: false, work: false },
    };
    for (const v of visits) {
      if (p.lat == null && v.lat != null) [p.lat, p.lng] = [v.lat, v.lng];
      p.visits++;
      p.semantic[v.semantic] = (p.semantic[v.semantic] || 0) + 1;
      p.timelineName ??= v.name || null;
      p.timelineAddress ??= v.address || null;
    }
    for (const v of own) {
      p.topVisits++;
      p.minutes += (v.end - v.start) / 60000;
      p.first = Math.min(p.first, v.start);
      p.last = Math.max(p.last, v.start);
      p.weeks.add(weekKey(v.start, v.offset));
      const nights = nightsOf(v);
      for (const night of nights) {
        const month = localDate(night, v.offset).slice(0, 7);
        p.nights++;
        p.nightMonths.add(month);
        p.nightList.push({ start: night, month, visitStart: v.start });
      }
      if (!nights.length && isWorkday(v)) {
        p.workDays.add(localDate(v.start, v.offset));
      }
    }
    places.set(placeId, p);
  }

  // 2. Home (over time) and work, from where you sleep and spend weekdays, with
  // your labels deciding and Google's HOME/WORK labels as hints.
  const count = (p, set) => Object.entries(p.semantic).reduce((s, [k, n]) => s + (set.has(k) ? n : 0), 0);
  for (const p of places.values()) {
    p.tags.home = ds.frequent[p.placeId] === "HOME" || count(p, HOME_SEMANTICS) >= rules.minLabelVisits;
    p.tags.work = ds.frequent[p.placeId] === "WORK" || count(p, WORK_SEMANTICS) >= rules.minLabelVisits;
  }
  // Very short exports: a single HOME/WORK tag is better than nothing.
  for (const [kind, set] of [["home", HOME_SEMANTICS], ["work", WORK_SEMANTICS]]) {
    if ([...places.values()].some((p) => p.tags[kind])) continue;
    let top = null;
    for (const p of places.values()) {
      const n = count(p, set);
      if (n > 0 && (!top || n > top.n)) top = { p, n };
    }
    if (top) top.p.tags[kind] = true;
  }
  const found = detectHomeAndWork(places, labels, rules);
  for (const p of places.values()) {
    const label = labels[p.placeId] || {};
    if (label.kind) [p.kind, p.kindSource] = [label.kind, "you"];
    else if (found.homePlaces.has(p.placeId)) [p.kind, p.kindSource] = ["home", p.tags.home ? "timeline" : "pattern"];
    else if (found.workPlaces.has(p.placeId)) [p.kind, p.kindSource] = ["work", p.tags.work ? "timeline" : "pattern"];
    delete p.nightList;
    delete p.workDays;
  }

  const home = HomeLocator.from(found.anchors, places, ds.top);
  matchSaved(places, saved);

  // 3. Identity, geography and the remaining kinds.
  for (const p of places.values()) {
    const label = labels[p.placeId] || {};
    const g = google[p.placeId];
    const o = osm[p.placeId];

    let name = null;
    let nameSource = null;
    if (label.name) [name, nameSource] = [label.name, "you"];
    else if (p.savedName) [name, nameSource] = [p.savedName, "saved"];
    else if (g?.name) [name, nameSource] = [g.name, "google"];
    else if (p.timelineName) [name, nameSource] = [p.timelineName, "timeline"];
    else if (o?.name) [name, nameSource] = [o.name, "osm"];

    let cat = { category: null, routine: false };
    if (g?.types?.length) cat = categoryFromTypes(g.primaryType ? [g.primaryType, ...g.types] : g.types);
    if (!cat.category && o?.tags) cat = categoryFromOsm(o.tags);

    const geo = geocoder ? geocoder.lookup(p.lat, p.lng) : {};
    // Aliases fix gazetteer quirks once for every place ("Kanayannur" -> "Kochi").
    const geoCity = geo.city ? cityAliases[geo.city] ?? geo.city : null;
    p.city = label.city ?? geoCity;
    p.state = label.state ?? geo.state ?? null;
    p.country = label.country ?? geo.country ?? null;
    p.name = name;
    p.nameSource = nameSource;
    p.category = label.category ?? cat.category;
    p.routineType = cat.routine;
    p.theme = label.theme ?? themeFor(p.category);
    p.address = g?.address ?? p.timelineAddress ?? null;
    p.uri = g?.uri ?? null;
    p.website = g?.website ?? null;
    p.rating = g?.rating ?? null;
    p.ratingCount = g?.ratingCount ?? null;
    p.hidden = Boolean(label.hidden);
    p.note = label.note ?? null;

    if (!p.kind) {
      const distances = [];
      for (const v of ownVisits(ds.byPlace.get(p.placeId))) {
        const h = home.at(v.start);
        if (h && p.lat != null) distances.push(haversineKm(p.lat, p.lng, h.lat, h.lng));
      }
      const nearHome = (median(distances) ?? Infinity) <= awayKm;
      if (p.nights >= rules.familyNights && p.nightMonths.size >= rules.familyMonths) p.kind = "family";
      else if (p.routineType) p.kind = "everyday";
      else if (nearHome && p.weeks.size >= rules.everydayWeeks) p.kind = "everyday";
      else p.kind = "explored";
      p.kindSource = "pattern";
    }
    p.weekCount = p.weeks.size;
    delete p.weeks;
    delete p.nightMonths;
    p.area = o?.area ?? null;
    p.near = o?.near ?? null;
  }
  mergeNearby(places, labels);
  for (const p of places.values()) {
    // A one-off stop: somewhere explored once, briefly, that nothing reliable named
    // (fuel, a toll, a break on the road). Kept, but folded away in lists.
    p.oneoff = p.kind === "explored" && !p.groupMembers && p.topVisits <= 1 && p.minutes < ONE_OFF_MINUTES
      && !["you", "saved", "google", "timeline"].includes(p.nameSource);
  }
  return { places, home };
}

const SAVED_KM = 0.05;

/**
 * Your Google Maps saved and labelled places name the visited place at the same
 * spot (both carry Google's own coordinates for the place, so they sit metres
 * apart). Each saved place names its nearest visited place within 50 m.
 */
function matchSaved(places, saved) {
  if (!saved.length) return;
  const cell = (lat, lng) => `${Math.floor(lat / 0.001)}:${Math.floor(lng / 0.001)}`;
  const grid = new Map();
  for (const p of places.values()) {
    if (p.lat == null) continue;
    const c = cell(p.lat, p.lng);
    grid.set(c, [...(grid.get(c) || []), p]);
  }
  for (const s of saved) {
    const [ci, cj] = cell(s.lat, s.lng).split(":").map(Number);
    let best = null;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const p of grid.get(`${ci + di}:${cj + dj}`) || []) {
          const d = haversineKm(s.lat, s.lng, p.lat, p.lng);
          if (d <= SAVED_KM && (!best || d < best.d)) best = { p, d };
        }
      }
    }
    // Your own labels ("Grandma's place") beat a starred place's business name.
    if (best && (!best.p.savedName || s.source === "labelled")) {
      best.p.savedName = s.name;
      best.p.savedSource = s.source;
    }
  }
}

const ONE_OFF_MINUTES = 30; // fuel, a toll, a quick break; a sight takes longer
const MERGE_KM = 0.1;

/**
 * One place under several IDs: Google gives the same building different place IDs
 * over the years, and GPS drift spreads one stay over neighbouring IDs. Places
 * within 100 m are merged when they can't be told apart: the same home, work or
 * family place, the same name, or no name at all. Two named restaurants on one
 * street stay separate. The most visited ID leads; the others take its name and,
 * where you labelled the lead, your label.
 */
function mergeNearby(places, labels) {
  const key = (p) => (["home", "work", "family"].includes(p.kind) ? `k:${p.kind}`
    : p.name ? `n:${p.name.trim().toLowerCase()}` : "unnamed");
  const cell = (lat, lng) => `${Math.floor(lat / 0.001)}:${Math.floor(lng / 0.001)}`;
  const grid = new Map();
  const sorted = [...places.values()].filter((p) => p.lat != null).sort((a, b) => b.topVisits - a.topVisits || b.minutes - a.minutes);
  for (const p of sorted) {
    const k = key(p);
    const [ci, cj] = cell(p.lat, p.lng).split(":").map(Number);
    let lead = null;
    for (let di = -1; di <= 1 && !lead; di++) {
      for (let dj = -1; dj <= 1 && !lead; dj++) {
        for (const q of grid.get(`${ci + di}:${cj + dj}`) || []) {
          if (key(q) === k && haversineKm(p.lat, p.lng, q.lat, q.lng) <= MERGE_KM) {
            lead = q;
            break;
          }
        }
      }
    }
    if (lead && !labels[p.placeId]?.name && !(labels[p.placeId]?.kind && labels[p.placeId].kind !== lead.kind)) {
      p.groupLead = lead.placeId;
      (lead.groupMembers ??= []).push(p.placeId);
      if (!p.name && lead.name) [p.name, p.nameSource] = [lead.name, lead.nameSource];
      const ll = labels[lead.placeId] || {};
      const own = labels[p.placeId] || {};
      if (ll.kind && !own.kind) [p.kind, p.kindSource] = [ll.kind, "you"];
      if (ll.theme && !own.theme) p.theme = ll.theme;
      if (ll.hidden && own.hidden === undefined) p.hidden = true;
      continue;
    }
    const c = `${ci}:${cj}`;
    grid.set(c, [...(grid.get(c) || []), p]);
  }
}

/** A place's own visits: top-level ones, or nested ones if it was never visited directly. */
export function ownVisits(visits) {
  const top = visits.filter((v) => v.level === 0);
  return top.length ? top : visits;
}

/** Name to show when nothing named the place: the nearest landmark or the neighbourhood beats "Place in Mysuru". */
export function displayName(p) {
  if (p.name) return p.name;
  if (p.kind === "home") return "Home";
  if (p.kind === "work") return "Work";
  if (p.near) return `Near ${p.near}`;
  if (p.area && p.city && p.area.toLowerCase() !== p.city.toLowerCase()) return `${p.area}, ${p.city}`;
  if (p.area) return p.area;
  return p.city ? `Place in ${p.city}` : "Unnamed place";
}
