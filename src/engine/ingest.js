// The imported timeline: visits, movements and GPS points, merged across
// imports. Re-importing the same or a newer export only adds what is new.

const MODE_BY_ACTIVITY = {
  FLYING: "flight",
  IN_PASSENGER_VEHICLE: "car",
  IN_VEHICLE: "car",
  IN_TAXI: "car",
  DRIVING: "car",
  MOTORCYCLING: "motorbike",
  IN_TRAIN: "train",
  IN_SUBWAY: "train",
  IN_TRAM: "train",
  IN_BUS: "bus",
  IN_FERRY: "boat",
  SAILING: "boat",
  WALKING: "walk",
  RUNNING: "walk",
  HIKING: "walk",
  ON_FOOT: "walk",
  CYCLING: "cycle",
  ON_BICYCLE: "cycle",
};

export function modeFor(type) {
  const key = String(type || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return MODE_BY_ACTIVITY[key] || "other";
}

export const visitKey = (v) => `${v.start}|${v.placeId}|${v.level}`;

/** Collects one import's records; `Dataset.merge` folds them in. */
export class Batch {
  constructor() {
    this.visits = [];
    this.moves = [];
    this.t = [];
    this.lat = [];
    this.lng = [];
    this.frequent = new Map();
    this.saved = [];
  }
  savedPlace(s) {
    this.saved.push(s);
  }
  visit(v) {
    if (v.end >= v.start) this.visits.push(v);
  }
  move(m) {
    if (m.end >= m.start) this.moves.push({ ...m, mode: modeFor(m.type) });
  }
  point(t, lat, lng) {
    this.t.push(t);
    this.lat.push(lat);
    this.lng.push(lng);
  }
  frequentPlace(placeId, label) {
    this.frequent.set(placeId, label);
  }
}

export class Dataset {
  constructor(data) {
    this.visits = data?.visits ?? [];
    this.moves = data?.moves ?? [];
    this.points = data?.points ?? { t: new Float64Array(0), lat: new Float32Array(0), lng: new Float32Array(0) };
    this.frequent = data?.frequent ?? {};
    this.imports = data?.imports ?? [];
    this.index();
  }

  /** Plain object for IndexedDB (structured clone keeps the typed arrays). */
  toJSON() {
    return { visits: this.visits, moves: this.moves, points: this.points, frequent: this.frequent, imports: this.imports };
  }

  get empty() {
    return this.visits.length === 0;
  }

  index() {
    this.visits.sort((a, b) => a.start - b.start || a.level - b.level);
    this.moves.sort((a, b) => a.start - b.start);
    this.top = this.visits.filter((v) => v.level === 0);
    this.byPlace = new Map();
    for (const v of this.visits) {
      if (!this.byPlace.has(v.placeId)) this.byPlace.set(v.placeId, []);
      this.byPlace.get(v.placeId).push(v);
    }
  }

  merge(batch, meta = {}) {
    const known = new Set(this.visits.map(visitKey));
    let addedVisits = 0;
    for (const v of batch.visits) {
      const key = visitKey(v);
      if (known.has(key)) continue;
      known.add(key);
      this.visits.push({ ...v, key });
      addedVisits++;
    }
    const knownMoves = new Set(this.moves.map((m) => m.start));
    let addedMoves = 0;
    for (const m of batch.moves) {
      if (knownMoves.has(m.start)) continue;
      knownMoves.add(m.start);
      this.moves.push(m);
      addedMoves++;
    }
    const addedPoints = this.mergePoints(batch);
    Object.assign(this.frequent, Object.fromEntries(batch.frequent));
    this.index();
    this.linkNested();

    const range = extent(batch.visits);
    const record = {
      at: Date.now(),
      name: meta.name ?? null,
      format: meta.format ?? null,
      read: { visits: batch.visits.length, moves: batch.moves.length, points: batch.t.length },
      added: { visits: addedVisits, moves: addedMoves, points: addedPoints },
      from: range?.[0] ?? null,
      to: range?.[1] ?? null,
    };
    this.imports.push(record);
    return record;
  }

  mergePoints(batch) {
    if (!batch.t.length) return 0;
    const oldN = this.points.t.length;
    const order = [...Array(oldN + batch.t.length).keys()];
    const tAt = (i) => (i < oldN ? this.points.t[i] : batch.t[i - oldN]);
    order.sort((a, b) => tAt(a) - tAt(b));
    const t = [];
    const lat = [];
    const lng = [];
    for (const i of order) {
      const ti = tAt(i);
      if (t.length && t[t.length - 1] === ti) continue;
      t.push(ti);
      lat.push(i < oldN ? this.points.lat[i] : batch.lat[i - oldN]);
      lng.push(i < oldN ? this.points.lng[i] : batch.lng[i - oldN]);
    }
    this.points = { t: Float64Array.from(t), lat: Float32Array.from(lat), lng: Float32Array.from(lng) };
    return t.length - oldN;
  }

  /** Point each nested visit (hierarchy level > 0) at the top-level visit containing it. */
  linkNested() {
    const starts = this.top.map((v) => v.start);
    for (const v of this.visits) {
      if (v.level === 0) continue;
      let lo = 0;
      let hi = starts.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= v.start) lo = mid + 1;
        else hi = mid;
      }
      const parent = this.top[lo - 1];
      v.parentKey = parent && parent.end >= v.end ? parent.key : null;
    }
  }

  /** GPS points in [start, end) as [[ms, lat, lng]]. */
  pointsBetween(start, end) {
    const { t, lat, lng } = this.points;
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid] < start) lo = mid + 1;
      else hi = mid;
    }
    const out = [];
    for (let i = lo; i < t.length && t[i] < end; i++) out.push([t[i], lat[i], lng[i]]);
    return out;
  }

  get span() {
    return extent(this.visits);
  }
}

/** [earliest start, latest end] without spreading large arrays into Math.min/max. */
function extent(visits) {
  if (!visits.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of visits) {
    if (v.start < lo) lo = v.start;
    if (v.end > hi) hi = v.end;
  }
  return [lo, hi];
}
