// Home and work from behaviour, not from labels alone.
//
// Home is where you sleep. Real exports scatter the nights at home across several
// place IDs a few hundred metres apart (GPS drift, neighbouring buildings, and
// Google re-labelling the same building over the years), so nights are grouped by
// area first: each month, the area (about 1 km across) with the most nights holds
// home. Consecutive months in the same area form one home; homes change over time
// (one city, then another). The place IDs you actually slept at in
// that area become "home".
//
// Work is where you spend long weekday daytimes, on many days.
// Your own labels decide whenever they say something; Google's HOME/WORK labels
// only break ties, and stand in when behaviour says nothing (a very short export).

import { haversineKm } from "./geo.js";

export const HOME_KM = 1.0; // nights within this of each other are one home area
export const SITE_KM = 0.5; // place IDs within this are one site (one office, one building)
export const HOME_RULES = {
  monthNights: 6, // nights in a month for an area to hold home that month...
  monthShare: 0.5, // ...or this share of the month's nights (with at least minNights)
  minNights: 3,
  minMonths: 2, // a home holds at least this many months in total
  homeShare: 0.03, // a place gets "home" with this share of its home's nights (and minNights)
  workDays: 30, // weekdays with a long daytime stay that make a place work
};

/** Group items with { lat, lng, weight } greedily: heaviest first, each joins the first group within km. */
function cluster(items, km) {
  const groups = [];
  for (const it of [...items].sort((a, b) => b.weight - a.weight)) {
    let g = groups.find((x) => haversineKm(it.lat, it.lng, x.anchor.lat, x.anchor.lng) <= km);
    if (!g) {
      g = { anchor: it, items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}

/** Place IDs within SITE_KM grouped into sites. @returns Map<placeId, site> */
export function buildSites(candidates, km = SITE_KM) {
  const of = new Map();
  const items = candidates.filter((p) => p.lat != null)
    .map((p) => ({ lat: p.lat, lng: p.lng, weight: p.nights * 1e6 + p.minutes, p }));
  cluster(items, km).forEach((g, id) => {
    const site = { id, anchor: g.anchor.p, placeIds: g.items.map((it) => it.p.placeId) };
    for (const it of g.items) of.set(it.p.placeId, site);
  });
  return of;
}

/**
 * @param places   Map<placeId, place> with nightList [{ start, month, visitStart }], workDays Set, tags { home, work }
 * @param labels   your labels by placeId
 * @returns { homePlaces: Set<placeId>, workPlaces: Set<placeId>, anchors: [{ start, end, lat, lng, placeId }] }
 */
export function detectHomeAndWork(places, labels = {}, overrides = {}) {
  const rules = { ...HOME_RULES, ...overrides };
  const kindOf = (id) => labels[id]?.kind;
  const all = [...places.values()].filter((p) => p.lat != null);

  // --- Home -----------------------------------------------------------------------
  // Nights per month per place, leaving out places you said aren't home.
  const months = new Map(); // month -> Map<placeId, { nights, first, last, stays }>
  for (const p of all) {
    if (kindOf(p.placeId) && kindOf(p.placeId) !== "home") continue;
    for (const n of p.nightList) {
      const m = months.get(n.month) ?? new Map();
      const e = m.get(p.placeId) ?? { nights: 0, first: Infinity, last: -Infinity, stays: [] };
      e.nights++;
      e.first = Math.min(e.first, n.visitStart);
      e.last = Math.max(e.last, n.start);
      e.stays.push(n);
      m.set(p.placeId, e);
      months.set(n.month, m);
    }
  }

  // Each month: group the nights by area; the area with the most nights holds home
  // if it clearly dominates. An area holding a place you said is home always wins;
  // Google's HOME label breaks ties.
  const byMonth = [];
  for (const month of [...months.keys()].sort()) {
    const m = months.get(month);
    const items = [...m.entries()].map(([id, e]) => ({ lat: places.get(id).lat, lng: places.get(id).lng, weight: e.nights, id, e }));
    const total = items.reduce((s, it) => s + it.weight, 0);
    let best = null;
    for (const g of cluster(items, HOME_KM)) {
      const nights = g.items.reduce((s, it) => s + it.weight, 0);
      const stated = g.items.some((it) => kindOf(it.id) === "home");
      const tagged = g.items.some((it) => places.get(it.id).tags.home);
      const score = (stated ? 1e6 : 0) + nights + (tagged ? 0.5 : 0);
      if (!best || score > best.score) best = { g, nights, stated, score };
    }
    if (!best) continue;
    const clear = best.stated || best.nights >= rules.monthNights
      || (best.nights >= rules.minNights && best.nights / total >= rules.monthShare);
    if (clear) byMonth.push({ month, ...best });
  }

  // Consecutive months in the same area are one home. A stretch needs a couple of
  // months (or your say-so), so a long trip or a stay with family isn't a home;
  // a short stretch elsewhere between two of the same home doesn't split it.
  const stretches = [];
  for (const b of byMonth) {
    const a = b.g.anchor;
    let s = stretches[stretches.length - 1];
    if (!s || haversineKm(a.lat, a.lng, s.lat, s.lng) > HOME_KM * 1.5) {
      s = { lat: a.lat, lng: a.lng, months: 0, stated: false, nights: new Map(), stays: [], last: -Infinity };
      stretches.push(s);
    }
    s.months++;
    s.stated ||= b.stated;
    for (const it of b.g.items) {
      s.nights.set(it.id, (s.nights.get(it.id) || 0) + it.weight);
      s.stays.push(...it.e.stays);
      s.last = Math.max(s.last, it.e.last);
    }
  }
  const homes = [];
  for (const s of stretches) {
    if (s.months < rules.minMonths && !s.stated) continue;
    const prev = homes[homes.length - 1];
    if (prev && haversineKm(s.lat, s.lng, prev.lat, prev.lng) <= HOME_KM * 1.5) {
      for (const [id, n] of s.nights) prev.nights.set(id, (prev.nights.get(id) || 0) + n);
      prev.stays.push(...s.stays);
      prev.last = Math.max(prev.last, s.last);
    } else {
      homes.push(s);
    }
  }

  const homePlaces = new Set();
  const anchors = [];
  let prevLast = -Infinity;
  for (const h of homes) {
    const total = [...h.nights.values()].reduce((a, b) => a + b, 0);
    let rep = null;
    for (const [id, n] of h.nights) {
      if (n >= rules.minNights && n >= total * rules.homeShare) homePlaces.add(id);
      if (!rep || n > h.nights.get(rep)) rep = id;
    }
    // A home starts at your first stay there after the last night at the previous
    // one, so the days around a move aren't a "trip" to your own new city.
    let start = Infinity;
    for (const n of h.stays) if (n.start > prevLast && n.visitStart < start) start = n.visitStart;
    if (!Number.isFinite(start)) start = Math.min(...h.stays.map((n) => n.visitStart));
    const p = places.get(rep);
    anchors.push({ start: Math.max(start, prevLast), end: h.last, lat: p.lat, lng: p.lng, placeId: rep });
    prevLast = h.last;
  }
  // Drift reaches past the area's edge: a place near a home where you slept
  // several nights while living there is part of that home too.
  for (const p of all) {
    if (homePlaces.has(p.placeId) || (kindOf(p.placeId) && kindOf(p.placeId) !== "home")) continue;
    for (const a of anchors) {
      if (haversineKm(p.lat, p.lng, a.lat, a.lng) > HOME_KM * 1.5) continue;
      const nights = p.nightList.filter((n) => n.start >= a.start && n.start <= a.end).length;
      if (nights >= rules.minNights) homePlaces.add(p.placeId);
    }
  }
  for (const p of all) if (kindOf(p.placeId) === "home") homePlaces.add(p.placeId);

  // --- Work -----------------------------------------------------------------------
  const notHome = all.filter((p) => !homePlaces.has(p.placeId));
  const sites = new Set(buildSites(notHome.filter((p) => p.workDays.size || p.tags.work || kindOf(p.placeId) === "work")).values());
  const workPlaces = new Set();
  const vetoed = (site, kind) => site.placeIds.some((id) => kindOf(id) && kindOf(id) !== kind);
  for (const s of sites) {
    if (vetoed(s, "work")) continue;
    const days = new Set();
    for (const id of s.placeIds) for (const d of places.get(id).workDays) days.add(d);
    if (days.size >= rules.workDays) s.placeIds.forEach((id) => workPlaces.add(id));
  }
  for (const p of all) if (kindOf(p.placeId) === "work") workPlaces.add(p.placeId);

  // --- Very short exports: no clear nights or workdays, so Google's labels stand in.
  if (!anchors.length && ![...homePlaces].length) {
    for (const s of new Set(buildSites(all.filter((p) => p.tags.home)).values())) {
      if (vetoed(s, "home")) continue;
      s.placeIds.forEach((id) => homePlaces.add(id));
      const first = Math.min(...s.placeIds.map((id) => places.get(id).first));
      const last = Math.max(...s.placeIds.map((id) => places.get(id).last));
      if (Number.isFinite(first)) anchors.push({ start: first, end: last, lat: s.anchor.lat, lng: s.anchor.lng, placeId: s.anchor.placeId });
    }
  }
  if (![...workPlaces].some((id) => kindOf(id) !== "work")) {
    for (const s of new Set(buildSites(notHome.filter((p) => p.tags.work)).values())) {
      if (vetoed(s, "work")) continue;
      if (s.placeIds.reduce((n, id) => n + places.get(id).topVisits, 0) >= 3) s.placeIds.forEach((id) => workPlaces.add(id));
    }
  }
  for (const id of homePlaces) workPlaces.delete(id);
  anchors.sort((a, b) => a.start - b.start);
  return { homePlaces, workPlaces, anchors };
}
