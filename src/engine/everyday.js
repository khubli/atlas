// Everyday life: commutes between home and work, the places that make up a
// routine, and where the hours go. Trips are about leaving; this is about staying.

import { haversineKm } from "./geo.js";
import { displayName } from "./places.js";
import { localDate, localHour, HOUR } from "./time.js";
import { windowed } from "./trips.js";

const MAX_COMMUTE_HOURS = 4;

/** Home->work and work->home legs, allowing short stops on the way (coffee, school run). */
export function commuteLegs(atlas) {
  const { ds, places } = atlas;
  const legs = [];
  const top = ds.top;
  for (let i = 0; i < top.length; i++) {
    const a = top[i];
    const pa = places.get(a.placeId);
    if (!pa || (pa.kind !== "home" && pa.kind !== "work")) continue;
    for (let j = i + 1; j < top.length; j++) {
      const b = top[j];
      if (b.start - a.end > MAX_COMMUTE_HOURS * HOUR) break;
      const pb = places.get(b.placeId);
      if (!pb || pb.placeId === pa.placeId) break;
      if (pb.kind !== "home" && pb.kind !== "work") continue;
      if (pb.kind === pa.kind) break;
      const moves = windowed(ds.moves, a.end - 60000, b.start);
      let km = moves.reduce((s, m) => s + m.km, 0);
      if (!km) km = haversineKm(pa.lat, pa.lng, pb.lat, pb.lng) || 0;
      const byMode = {};
      for (const m of moves) byMode[m.mode] = (byMode[m.mode] || 0) + m.km;
      const mode = Object.entries(byMode).filter(([k]) => k !== "walk").sort((x, y) => y[1] - x[1])[0]?.[0]
        ?? Object.keys(byMode)[0] ?? "other";
      legs.push({
        to: pb.kind,
        start: a.end,
        end: b.start,
        offset: a.offset,
        date: localDate(a.end, a.offset),
        minutes: Math.round((b.start - a.end) / 60000),
        km: Math.round(km * 10) / 10,
        mode,
        departHour: localHour(a.end, a.offset),
      });
      break;
    }
  }
  return legs;
}

export function everyday(atlas) {
  const { ds, places } = atlas;
  const legs = commuteLegs(atlas);

  const months = new Map();
  const month = (m) => {
    if (!months.has(m)) months.set(m, { month: m, legs: 0, days: new Set(), km: 0, minutes: 0, modes: {}, home_h: 0, work_h: 0, everyday_h: 0, explored_h: 0 });
    return months.get(m);
  };
  for (const l of legs) {
    const m = month(l.date.slice(0, 7));
    m.legs++;
    m.days.add(l.date);
    m.km += l.km;
    m.minutes += l.minutes;
    m.modes[l.mode] = (m.modes[l.mode] || 0) + l.km;
  }
  for (const v of ds.top) {
    const p = places.get(v.placeId);
    if (!p) continue;
    const m = month(localDate(v.start, v.offset).slice(0, 7));
    const h = (v.end - v.start) / HOUR;
    if (p.kind === "home" || p.kind === "family") m.home_h += h;
    else if (p.kind === "work") m.work_h += h;
    else if (p.kind === "everyday") m.everyday_h += h;
    else m.explored_h += h;
  }

  const regular = [...places.values()]
    .filter((p) => p.kind === "everyday" && !p.hidden && p.lat != null)
    .sort((a, b) => b.weekCount - a.weekCount || b.topVisits - a.topVisits)
    .slice(0, 20)
    .map((p) => ({
      place_id: p.placeId, name: displayName(p), named: Boolean(p.name), theme: p.theme, city: p.city,
      visits: p.topVisits, weeks: p.weekCount, minutes: Math.round(p.minutes),
    }));

  const toWork = legs.filter((l) => l.to === "work");
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const workPlaces = [...places.values()].filter((p) => p.kind === "work" && !p.hidden);
  const homePlaces = [...places.values()].filter((p) => p.kind === "home");

  return {
    has_home: homePlaces.length > 0,
    has_work: workPlaces.length > 0,
    commute: {
      legs: legs.length,
      days: new Set(legs.map((l) => l.date)).size,
      km: Math.round(legs.reduce((s, l) => s + l.km, 0)),
      hours: Math.round(legs.reduce((s, l) => s + l.minutes, 0) / 60),
      avg_minutes: Math.round(avg(legs.map((l) => l.minutes))),
      avg_km: Math.round(avg(legs.map((l) => l.km)) * 10) / 10,
      avg_depart_hour: toWork.length ? Math.round(avg(toWork.map((l) => l.departHour)) * 4) / 4 : null,
    },
    months: [...months.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({
        month: m.month,
        legs: m.legs,
        days: m.days.size,
        km: Math.round(m.km),
        hours: Math.round((m.minutes / 60) * 10) / 10,
        modes: Object.fromEntries(Object.entries(m.modes).map(([k, v]) => [k, Math.round(v)])),
        home_h: Math.round(m.home_h),
        work_h: Math.round(m.work_h),
        everyday_h: Math.round(m.everyday_h),
        explored_h: Math.round(m.explored_h),
      })),
    work: workPlaces.map((p) => ({ place_id: p.placeId, name: displayName(p), city: p.city, visits: p.topVisits })),
    regular,
  };
}
