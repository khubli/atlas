// The engine's single entry point: holds the dataset and the user's labels,
// settings and enrichment caches, and answers the app's queries. Results use
// the same JSON shapes the 0.4 server API returned, so the views carry over.

import { themeFor } from "./classify.js";
import { everyday } from "./everyday.js";
import { haversineKm } from "./geo.js";
import { displayName, ownVisits, resolvePlaces } from "./places.js";
import { localDate, localIso } from "./time.js";
import { DEFAULT_LENS, detectTrips, tripPath, windowed } from "./trips.js";

const iso = (ms, offset) => (ms == null ? null : localIso(ms, offset));

export class Atlas {
  /**
   * @param o.dataset   Dataset
   * @param o.geocoder  Geocoder (optional in tests)
   * @param o.labels    { placeId: { name, kind, theme, category, city, state, country, hidden, note } }
   * @param o.google    { placeId: { name, types, primaryType, address, uri, rating, ratingCount, website } }
   * @param o.osm       { placeId: { name, tags, distance } }
   * @param o.lens      trip rules (see DEFAULT_LENS)
   * @param o.tripEdits { tripId: { title, hidden } }
   * @param o.cityAliases { "Kanayannur": "Kochi" }
   */
  constructor(o) {
    this.ds = o.dataset;
    this.geocoder = o.geocoder ?? null;
    this.labels = o.labels ?? {};
    this.google = o.google ?? {};
    this.osm = o.osm ?? {};
    this.saved = o.saved ?? [];
    this.lens = { ...DEFAULT_LENS, ...(o.lens ?? {}) };
    this.tripEdits = o.tripEdits ?? {};
    this.cityAliases = o.cityAliases ?? {};
    this.invalidate();
  }

  invalidate() {
    this._resolved = null;
    this._trips = null;
  }

  update(patch) {
    Object.assign(this, patch);
    if (patch.lens) this.lens = { ...DEFAULT_LENS, ...patch.lens };
    this.invalidate();
  }

  get resolved() {
    this._resolved ??= resolvePlaces(this.ds, {
      labels: this.labels, google: this.google, osm: this.osm, saved: this.saved, geocoder: this.geocoder, awayKm: this.lens.awayKm,
      cityAliases: this.cityAliases,
    });
    return this._resolved;
  }

  get places() {
    return this.resolved.places;
  }

  get home() {
    return this.resolved.home;
  }

  /** All detected trips, oldest first, with your renames and hidden flags applied. */
  get allTrips() {
    if (!this._trips) {
      this._trips = detectTrips(this.ds, this.places, this.home, this.lens).map((t) => {
        const edit = this.tripEdits[t.id] || {};
        return { ...t, detected_title: t.title, title: edit.title || t.title, hidden: Boolean(edit.hidden) };
      });
      this._tripOf = new Map();
      for (const t of this._trips) {
        for (const v of windowed(this.ds.visits, t.start, t.end)) this._tripOf.set(v.key, t);
      }
    }
    return this._trips;
  }

  get trips() {
    return this.allTrips.filter((t) => !t.hidden);
  }

  tripOfVisit(v) {
    this.allTrips;
    const t = this._tripOf.get(v.key);
    return t && !t.hidden ? t : null;
  }

  /** Places you explored, one per merged place, without one-off stops. */
  explored() {
    return [...this.places.values()].filter((p) => p.kind === "explored" && !p.hidden && !p.oneoff && !p.groupLead);
  }

  // ---- queries -----------------------------------------------------------------------

  status() {
    const span = this.ds.span;
    return {
      empty: this.ds.empty,
      visits: this.ds.visits.length,
      places: this.places.size,
      points: this.ds.points.t.length,
      first: span ? localDate(span[0], this.ds.visits[0].offset) : null,
      last: span ? localDate(span[1], this.ds.visits[this.ds.visits.length - 1].offset) : null,
      imports: this.ds.imports,
      named: [...this.places.values()].filter((p) => p.name && !p.groupLead).length,
      needsName: [...this.places.values()].filter((p) => !p.name && !p.groupLead && !p.oneoff && !["home", "work"].includes(p.kind)).length,
      oneoffs: [...this.places.values()].filter((p) => p.oneoff).length,
      lens: this.lens,
    };
  }

  overview() {
    const trips = this.trips;
    const explored = this.explored();
    let exploredVisits = 0;
    let firstVisit = Infinity;
    for (const p of explored) {
      exploredVisits += p.topVisits;
      firstVisit = Math.min(firstVisit, p.first);
    }

    const states = new Set(explored.map((p) => p.state).filter(Boolean));
    const countries = new Set(explored.map((p) => p.country).filter(Boolean));
    const cities = new Set(explored.filter((p) => p.city).map((p) => `${p.city}|${p.state ?? ""}`));
    for (const t of trips) {
      t.states.forEach((s) => states.add(s));
      t.countries.forEach((c) => countries.add(c));
    }

    const years = new Map();
    const year = (y) => {
      if (!years.has(y)) years.set(y, { year: y, journeys: 0, nights: 0, days_away: 0, distance_km: 0, new_places: 0 });
      return years.get(y);
    };
    for (const t of trips) {
      const y = year(t.start_date.slice(0, 4));
      y.journeys++;
      y.nights += t.nights;
      y.days_away += t.nights + 1;
      y.distance_km += t.distance_km;
    }
    for (const p of explored) {
      const v = ownVisits(this.ds.byPlace.get(p.placeId))[0];
      if (v) year(localDate(v.start, v.offset).slice(0, 4)).new_places++;
    }

    const stateRows = new Map();
    for (const p of explored) {
      if (!p.state) continue;
      const r = stateRows.get(p.state) ?? { state: p.state, country: p.country, places: 0, visits: 0, first_visit: null, trips: 0 };
      r.places++;
      r.visits += p.topVisits;
      const first = iso(p.first, this.ds.byPlace.get(p.placeId)[0].offset);
      if (!r.first_visit || first < r.first_visit) r.first_visit = first;
      stateRows.set(p.state, r);
    }
    for (const t of trips) {
      for (const s of t.states) {
        const r = stateRows.get(s) ?? { state: s, country: t.primary_country, places: 0, visits: 0, first_visit: t.start_date, trips: 0 };
        r.trips++;
        stateRows.set(s, r);
      }
    }

    const dest = new Map();
    for (const t of trips) {
      for (const c of t.cities) {
        const key = `${c.city}|${c.state ?? ""}`;
        const r = dest.get(key) ?? { city: c.city, state: c.state, trips: 0, minutes: 0, last_date: t.start_date };
        r.trips++;
        r.minutes += c.minutes;
        if (t.start_date > r.last_date) r.last_date = t.start_date;
        dest.set(key, r);
      }
    }

    const transport = new Map();
    for (const t of trips) {
      for (const [mode, km] of Object.entries(t.transport)) {
        const r = transport.get(mode) ?? { mode, km: 0, trips: 0 };
        r.km += km;
        r.trips++;
        transport.set(mode, r);
      }
    }

    const themes = new Map();
    for (const p of explored) themes.set(p.theme, (themes.get(p.theme) || 0) + 1);

    const kinds = {};
    for (const p of this.places.values()) if (!p.hidden) kinds[p.kind] = (kinds[p.kind] || 0) + 1;

    const farthest = trips.reduce((best, t) => (!best || t.max_distance_km > best.max_distance_km ? t : best), null);
    const days = trips.reduce((s, t) => s + t.nights + 1, 0);
    return {
      has_journeys: trips.length > 0,
      lens: this.lens,
      kinds,
      totals: {
        journeys: trips.length,
        day_trips: trips.filter((t) => t.kind === "day_trip").length,
        overnight: trips.filter((t) => t.kind === "overnight").length,
        nights: trips.reduce((s, t) => s + t.nights, 0),
        days_away: days,
        distance_km: Math.round(trips.reduce((s, t) => s + t.distance_km, 0)),
        first_date: trips[0]?.start_date ?? (Number.isFinite(firstVisit) ? localDate(firstVisit, 0) : null),
        last_date: trips[trips.length - 1]?.end_date ?? null,
        places: explored.length,
        all_places: [...this.places.values()].filter((p) => p.lat != null && p.topVisits > 0 && !p.hidden && !p.groupLead && !p.oneoff).length,
        oneoff_places: [...this.places.values()].filter((p) => p.oneoff && !p.hidden).length,
        visits: exploredVisits,
        cities: cities.size,
        states: states.size,
        countries: countries.size,
        farthest: farthest
          ? { id: farthest.id, title: farthest.title, start_date: farthest.start_date, max_distance_km: farthest.max_distance_km }
          : null,
      },
      years: [...years.values()]
        .map((y) => ({ ...y, distance_km: Math.round(y.distance_km) }))
        .sort((a, b) => a.year.localeCompare(b.year)),
      states: [...stateRows.values()].sort((a, b) => b.places - a.places || b.trips - a.trips),
      destinations: [...dest.values()].sort((a, b) => b.trips - a.trips || b.minutes - a.minutes).slice(0, 10),
      transport: [...transport.values()].map((r) => ({ ...r, km: Math.round(r.km) })).sort((a, b) => b.km - a.km),
      themes: [...themes.entries()].map(([theme, places]) => ({ theme, places })).sort((a, b) => b.places - a.places),
      journeys: [...trips].reverse().map((t) => this.tripSummary(t)),
    };
  }

  tripSummary(t) {
    const { start, end, startOffset, endOffset, ...rest } = t;
    return { ...rest, start_time: iso(start, startOffset), end_time: iso(end, endOffset) };
  }

  journeys({ includeHidden = false } = {}) {
    const list = includeHidden ? this.allTrips : this.trips;
    return { journeys: [...list].reverse().map((t) => this.tripSummary(t)), lens: this.lens };
  }

  journey(id) {
    const all = this.allTrips;
    const idx = all.findIndex((t) => t.id === Number(id));
    if (idx < 0) return null;
    const t = all[idx];
    const visible = this.trips;
    const vIdx = visible.indexOf(t);
    const prev = vIdx > 0 ? visible[vIdx - 1] : null;
    const next = vIdx >= 0 && vIdx < visible.length - 1 ? visible[vIdx + 1] : null;
    const countries = new Map();
    for (const x of visible) if (x.primary_country) countries.set(x.primary_country, (countries.get(x.primary_country) || 0) + 1);
    const homeCountry = [...countries.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
      ...this.tripSummary(t),
      home_country: homeCountry,
      path: tripPath(this.ds, t),
      visits: windowed(this.ds.top, t.start, t.end).map((v) => {
        const p = this.places.get(v.placeId);
        return {
          id: v.key,
          place_id: p.groupLead ?? v.placeId, // edits go to the merged place

          start_time: iso(v.start, v.offset),
          end_time: iso(v.end, v.offset),
          duration_minutes: Math.round((v.end - v.start) / 60000),
          name: displayName(p),
          named: Boolean(p.name),
          category: p.category,
          kind: p.kind,
          city: p.city,
          state: p.state,
          latitude: p.lat,
          longitude: p.lng,
          rating: p.rating,
          google_maps_uri: p.uri,
          theme: p.theme,
          routine: p.kind !== "explored" || p.hidden,
        };
      }),
      activities: windowed(this.ds.moves, t.start, t.end).map((m) => ({
        start_time: iso(m.start, m.offset),
        end_time: iso(m.end, m.offset),
        start_lat: m.from?.[0] ?? null,
        start_lng: m.from?.[1] ?? null,
        end_lat: m.to?.[0] ?? null,
        end_lng: m.to?.[1] ?? null,
        distance_meters: Math.round(m.km * 1000),
        mode: m.mode,
      })),
      prev: prev ? { id: prev.id, title: prev.title, start_date: prev.start_date } : null,
      next: next ? { id: next.id, title: next.title, start_date: next.start_date } : null,
    };
  }

  /** A place's visits, with those of the place IDs merged into it. */
  groupVisits(p) {
    const ids = [p.placeId, ...(p.groupMembers || [])];
    const all = ids.flatMap((id) => ownVisits(this.ds.byPlace.get(id) || []));
    return ids.length > 1 ? all.sort((a, b) => a.start - b.start) : all;
  }

  /** The place a (possibly merged) place ID shows as. */
  lead(placeId) {
    const p = this.places.get(placeId);
    return p?.groupLead ? this.places.get(p.groupLead) : p;
  }

  placeRow(p) {
    const visits = this.groupVisits(p);
    const members = (p.groupMembers || []).map((id) => this.places.get(id));
    const years = [...new Set(visits.map((v) => Number(localDate(v.start, v.offset).slice(0, 4))))].sort();
    const tripVisits = visits.filter((v) => this.tripOfVisit(v)).length;
    const offset = visits[0]?.offset ?? 0;
    return {
      place_id: p.placeId,
      name: displayName(p),
      named: Boolean(p.name),
      name_source: p.nameSource,
      approx: p.nameSource === "osm",
      category: p.category,
      theme: p.theme,
      kind: p.kind,
      kind_source: p.kindSource,
      hidden: p.hidden,
      city: p.city,
      state: p.state,
      country: p.country,
      formatted_address: p.address,
      latitude: p.lat,
      longitude: p.lng,
      rating: p.rating,
      user_rating_count: p.ratingCount,
      google_maps_uri: p.uri,
      visits: visits.length,
      trip_visits: tripVisits,
      first_visit: visits.length ? iso(visits[0].start, offset) : null,
      last_visit: visits.length ? iso(visits[visits.length - 1].start, visits[visits.length - 1].offset) : null,
      minutes: Math.round(p.minutes + members.reduce((m, q) => m + q.minutes, 0)),
      weeks: p.weekCount,
      nights: p.nights + members.reduce((n, q) => n + q.nights, 0),
      years,
      oneoff: p.oneoff,
      merged: members.length,
      area: p.area,
    };
  }

  placesList({ includeHidden = false, kinds = null } = {}) {
    const rows = [];
    for (const p of this.places.values()) {
      if (p.lat == null || p.topVisits === 0 || p.groupLead) continue;
      if (p.hidden && !includeHidden) continue;
      if (kinds && !kinds.includes(p.kind)) continue;
      rows.push(this.placeRow(p));
    }
    return { places: rows };
  }

  place(placeId) {
    const p = this.lead(placeId);
    if (!p) return null;
    placeId = p.placeId;
    const visits = [...this.groupVisits(p)].reverse();
    return {
      ...this.placeRow(p),
      website: p.website,
      note: p.note,
      label: this.labels[placeId] ?? {},
      sources: {
        google: this.google[placeId] ?? null,
        osm: this.osm[placeId] ?? null,
        saved: p.savedName ? { name: p.savedName, source: p.savedSource } : null,
        timeline: p.timelineName ? { name: p.timelineName, address: p.timelineAddress } : null,
      },
      visits: visits.slice(0, 300).map((v) => {
        const t = this.tripOfVisit(v);
        return {
          start_time: iso(v.start, v.offset),
          end_time: iso(v.end, v.offset),
          duration_minutes: Math.round((v.end - v.start) / 60000),
          journey_id: t?.id ?? null,
          journey_title: t?.title ?? null,
        };
      }),
    };
  }

  /** Trips and places on this month-day in earlier years. date = YYYY-MM-DD. */
  memories(date) {
    const year = date.slice(0, 4);
    const md = date.slice(5);
    const inSpan = (s, e) => {
      const a = s.slice(5);
      const b = e.slice(5);
      return a <= b ? md >= a && md <= b : md >= a || md <= b;
    };
    const journeys = this.trips
      .filter((t) => t.start_date.slice(0, 4) < year && inSpan(t.start_date, t.end_date))
      .reverse()
      .map((t) => ({ id: t.id, title: t.title, start_date: t.start_date, end_date: t.end_date, nights: t.nights, kind: t.kind }));
    const visits = [];
    for (const v of this.ds.top) {
      const d = localDate(v.start, v.offset);
      if (d.slice(5) !== md || d.slice(0, 4) >= year) continue;
      const p = this.places.get(v.placeId);
      if (!p || p.hidden || p.kind !== "explored") continue;
      const t = this.tripOfVisit(v);
      visits.push({
        start_time: iso(v.start, v.offset), journey_id: t?.id ?? null, place_id: p.placeId,
        name: displayName(p), category: p.category, city: p.city, state: p.state, theme: p.theme,
      });
    }
    visits.sort((a, b) => (a.journey_id == null) - (b.journey_id == null) || b.start_time.localeCompare(a.start_time));
    return { journeys, visits: visits.slice(0, 12) };
  }

  /** Homes over time, for the setup screen. */
  homes() {
    return this.home.periods().map((h) => {
      const p = this.places.get(h.placeId);
      const off = this.ds.byPlace.get(h.placeId)?.[0]?.offset ?? 0;
      return {
        place_id: h.placeId, from: localDate(h.from, off), to: localDate(h.to, off),
        latitude: p?.lat, longitude: p?.lng, city: p?.city, state: p?.state, country: p?.country, name: displayName(p),
        named: Boolean(p?.name), nights: p?.nights ?? 0, kind_source: p?.kindSource, guessed: h.guessed,
      };
    });
  }

  /** Places most worth labelling first: frequent, unnamed or only approximately named. */
  review() {
    const rows = [];
    for (const p of this.places.values()) {
      if (p.lat == null || p.topVisits === 0) continue;
      const needs = [];
      if (!p.name && !["home", "work"].includes(p.kind)) needs.push("name");
      if (p.nameSource === "osm") needs.push("check");
      if (!needs.length) continue;
      rows.push({ ...this.placeRow(p), needs });
    }
    rows.sort((a, b) => b.visits - a.visits);
    return { places: rows };
  }

  everyday() {
    return everyday(this);
  }

  /** Places nearest a point, for search-free relabelling ("what's this pin?"). */
  near(lat, lng, km = 0.5) {
    return [...this.places.values()]
      .map((p) => [p, haversineKm(lat, lng, p.lat, p.lng)])
      .filter(([, d]) => d != null && d <= km)
      .sort((a, b) => a[1] - b[1])
      .map(([p]) => this.placeRow(p));
  }
}

export { themeFor };
