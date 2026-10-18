// Everything the app asks of its data, run off the main thread. Holds the
// dataset and the Atlas engine, persists every change to IndexedDB, and never
// sends personal data anywhere (OpenStreetMap lookups send coordinates only).

import { Atlas } from "../engine/atlas.js";
import { readExport } from "../engine/formats/read.js";
import { Geocoder } from "../engine/geocode.js";
import { Batch, Dataset } from "../engine/ingest.js";
import { enrichFromOsm, OSM_VERSION, OVERPASS_URL } from "../engine/osm.js";
import { DEFAULT_LENS } from "../engine/trips.js";

export const DEFAULT_SETTINGS = {
  lens: DEFAULT_LENS,
  cityAliases: {},
  setupDone: false,
  demo: false,
  googleKey: null,
  googleUsage: { month: null, calls: 0 },
  osmEndpoint: OVERPASS_URL,
  autoNames: true, // look up OpenStreetMap names on its own after an import
};

const APP_VERSION = "1.0.0";

/** Typed arrays don't survive JSON; backups store plain arrays. */
function portable(ds) {
  const d = ds.toJSON();
  return { ...d, points: { t: Array.from(d.points.t), lat: Array.from(d.points.lat), lng: Array.from(d.points.lng) } };
}
function fromPortable(d) {
  if (!d) return new Dataset();
  const p = d.points || { t: [], lat: [], lng: [] };
  return new Dataset({ ...d, points: { t: Float64Array.from(p.t), lat: Float32Array.from(p.lat), lng: Float32Array.from(p.lng) } });
}

function applyPatch(target, patch) {
  const next = { ...(target || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "" || v === false) delete next[k];
    else next[k] = v;
  }
  return Object.keys(next).length ? next : null;
}

export class Service {
  /**
   * @param store          openStore() result
   * @param loadGazetteer  async () => gazetteer JSON
   * @param fetchFn        fetch, injectable for tests
   * @param offset         UTC offset (minutes) for timestamps without one
   */
  constructor({ store, loadGazetteer, fetchFn = fetch, offset = 0 }) {
    this.store = store;
    this.loadGazetteer = loadGazetteer;
    this.fetchFn = fetchFn;
    this.offset = offset;
  }

  async init() {
    const saved = await this.store.getAll();
    this.labels = saved.labels || {};
    this.google = saved.google || {};
    this.osm = saved.osm || {};
    this.saved = saved.saved || [];
    this.tripEdits = saved.tripEdits || {};
    this.settingsValue = { ...DEFAULT_SETTINGS, ...(saved.settings || {}), lens: { ...DEFAULT_LENS, ...(saved.settings?.lens || {}) } };
    this.dataset = saved.dataset ? new Dataset(saved.dataset) : new Dataset();
    this.geocoder ??= new Geocoder(await this.loadGazetteer());
    this.rebuild();
    return this.status();
  }

  rebuild() {
    this.atlas = new Atlas({
      dataset: this.dataset,
      geocoder: this.geocoder,
      labels: this.labels,
      google: this.google,
      osm: this.osm,
      saved: this.saved,
      lens: this.settingsValue.lens,
      tripEdits: this.tripEdits,
      cityAliases: this.settingsValue.cityAliases,
    });
  }

  status() {
    return { ...this.atlas.status(), settings: this.settings() };
  }

  settings() {
    const { googleKey, ...rest } = this.settingsValue;
    return { ...rest, hasGoogleKey: Boolean(googleKey) };
  }

  query(name, args = []) {
    const fn = {
      overview: () => this.atlas.overview(),
      journeys: (o) => this.atlas.journeys(o),
      journey: (id) => this.atlas.journey(id),
      places: (o) => this.atlas.placesList(o),
      place: (id) => this.atlas.place(id),
      memories: (date) => this.atlas.memories(date),
      homes: () => this.atlas.homes(),
      review: () => this.atlas.review(),
      everyday: () => this.atlas.everyday(),
      near: (lat, lng, km) => this.atlas.near(lat, lng, km),
      status: () => this.status(),
    }[name];
    if (!fn) throw new Error(`Unknown query: ${name}`);
    return fn(...args);
  }

  // ---- import -------------------------------------------------------------------------

  async importFiles(files, progress = () => {}) {
    const records = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const batch = new Batch();
      progress({ stage: "reading", file: file.name, index: i, count: files.length, fraction: 0 });
      const format = await readExport(file, batch, {
        offset: this.offset,
        onProgress: (fraction) => progress({ stage: "reading", file: file.name, index: i, count: files.length, fraction }),
      });
      progress({ stage: "merging", file: file.name });
      if (batch.saved.length) records.push(this.mergeSaved(batch.saved, file.name));
      if (format !== "saved") records.push(this.dataset.merge(batch, { name: file.name ?? null, format }));
    }
    progress({ stage: "saving" });
    await this.store.put("dataset", this.dataset.toJSON());
    await this.store.put("saved", this.saved);
    progress({ stage: "analysing" });
    this.rebuild();
    const status = this.status();
    return { records, status };
  }

  /** Your saved/labelled places: kept by name and spot, newest file winning. */
  mergeSaved(list, name) {
    const key = (x) => `${x.lat.toFixed(5)},${x.lng.toFixed(5)}`;
    const byKey = new Map(this.saved.map((x) => [key(x), x]));
    let added = 0;
    for (const x of list) {
      if (!byKey.has(key(x))) added++;
      byKey.set(key(x), x);
    }
    this.saved = [...byKey.values()];
    const record = { at: new Date().toISOString(), name: name ?? null, format: "saved", read: { visits: 0, saved: list.length }, added: { visits: 0, saved: added } };
    this.dataset.imports.push(record);
    return record;
  }

  async importDemo(timeline, places, progress) {
    const result = await this.importFiles([timeline], progress);
    Object.assign(this.google, places);
    this.settingsValue.demo = true;
    await this.store.put("google", this.google);
    await this.store.put("settings", this.settingsValue);
    this.rebuild();
    return { ...result, status: this.status() };
  }

  // ---- labels & edits ------------------------------------------------------------------

  async setLabel(placeId, patch) {
    const next = applyPatch(this.labels[placeId], patch);
    if (next) this.labels[placeId] = next;
    else delete this.labels[placeId];
    await this.store.put("labels", this.labels);
    this.atlas.update({ labels: this.labels });
    return this.atlas.place(placeId);
  }

  async bulkLabel(placeIds, patch) {
    for (const id of placeIds) {
      const next = applyPatch(this.labels[id], patch);
      if (next) this.labels[id] = next;
      else delete this.labels[id];
    }
    await this.store.put("labels", this.labels);
    this.atlas.update({ labels: this.labels });
    return placeIds.length;
  }

  async setTripEdit(id, patch) {
    const next = applyPatch(this.tripEdits[id], patch);
    if (next) this.tripEdits[id] = next;
    else delete this.tripEdits[id];
    await this.store.put("tripEdits", this.tripEdits);
    this.atlas.update({ tripEdits: this.tripEdits });
    return this.atlas.journey(id);
  }

  async setSettings(patch) {
    const s = { ...this.settingsValue, ...patch };
    if (patch.lens) s.lens = { ...this.settingsValue.lens, ...patch.lens };
    if (patch.cityAliases) {
      s.cityAliases = { ...this.settingsValue.cityAliases, ...patch.cityAliases };
      for (const [k, v] of Object.entries(s.cityAliases)) if (!v || v === k) delete s.cityAliases[k];
    }
    this.settingsValue = s;
    await this.store.put("settings", s);
    this.atlas.update({ lens: s.lens, cityAliases: s.cityAliases });
    return this.status();
  }

  // ---- naming services --------------------------------------------------------------------

  /** Places worth asking a naming service about: visited, unnamed by you, not home or work. */
  candidates(source) {
    const out = [];
    for (const p of this.atlas.places.values()) {
      if (p.lat == null || p.kind === "home" || p.kind === "work" || this.labels[p.placeId]?.name) continue;
      if (/AAAAAAAAAAA$/.test(p.placeId)) continue; // private/aliased ids Google won't resolve
      // Google lookups cost quota: one-off stops aren't worth one.
      if (source === "google" && this.google[p.placeId] === undefined && !p.oneoff) {
        out.push({ placeId: p.placeId, lat: p.lat, lng: p.lng, visits: p.topVisits });
      }
      // Everything not named by Google is asked once; older lookups are asked again for the neighbourhood.
      if (source === "osm" && !this.google[p.placeId]?.name && (this.osm[p.placeId]?.v ?? 0) < OSM_VERSION) {
        out.push({ placeId: p.placeId, lat: p.lat, lng: p.lng, visits: p.topVisits });
      }
    }
    return out.sort((a, b) => b.visits - a.visits);
  }

  pending() {
    return { google: this.candidates("google").length, osm: this.candidates("osm").length };
  }

  async enrichOsm(progress = () => {}, signal) {
    const todo = this.candidates("osm");
    let found = 0;
    await enrichFromOsm(todo, {
      fetchFn: this.fetchFn,
      endpoint: this.settingsValue.osmEndpoint || OVERPASS_URL,
      signal,
      onResult: (id, r) => {
        this.osm[id] = { ...r, ...(r.name ? {} : { none: true }), at: Date.now() };
        if (r.name || r.near || r.area) found++;
      },
      onProgress: async (done, total) => {
        progress({ stage: "osm", done, total, found });
        await this.store.put("osm", this.osm);
      },
    });
    await this.store.put("osm", this.osm);
    this.atlas.update({ osm: this.osm });
    return { looked: todo.length, found };
  }

  /** The Google key lives only here; the main thread fetches with it, then calls saveGoogle. */
  googleKey() {
    return this.settingsValue.googleKey;
  }

  async saveGoogle(results, calls = 0) {
    for (const [id, r] of Object.entries(results)) this.google[id] = r ?? { missing: true };
    const month = new Date().toISOString().slice(0, 7);
    const usage = this.settingsValue.googleUsage?.month === month ? this.settingsValue.googleUsage : { month, calls: 0 };
    this.settingsValue.googleUsage = { month, calls: usage.calls + calls };
    await this.store.put("google", this.google);
    await this.store.put("settings", this.settingsValue);
    this.atlas.update({ google: this.google });
    return this.pending();
  }

  // ---- backup, restore, labels file, reset --------------------------------------------------

  async exportBackup() {
    const { googleKey, ...settings } = this.settingsValue;
    const body = JSON.stringify({
      format: "atlas-backup", version: 1, app: APP_VERSION, created: new Date().toISOString(),
      dataset: portable(this.dataset), labels: this.labels, google: this.google, osm: this.osm, saved: this.saved,
      tripEdits: this.tripEdits, settings,
    });
    const stream = new Blob([body]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Response(stream).blob();
  }

  async readBackup(blob) {
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    const text = head[0] === 0x1f && head[1] === 0x8b
      ? await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text()
      : await blob.text();
    return JSON.parse(text);
  }

  /** Restore an .atlas backup, or merge a labels file exported from Atlas 0.4. */
  async restore(blob) {
    const data = await this.readBackup(blob);
    if (data.format === "atlas-labels") return this.importLabels(data);
    if (data.format !== "atlas-backup") throw new Error("This isn't an Atlas backup.");
    const googleKey = this.settingsValue.googleKey;
    this.dataset = fromPortable(data.dataset);
    this.labels = data.labels || {};
    this.google = data.google || {};
    this.osm = data.osm || {};
    this.saved = data.saved || [];
    this.tripEdits = data.tripEdits || {};
    this.settingsValue = { ...DEFAULT_SETTINGS, ...(data.settings || {}), googleKey };
    await this.persistAll();
    this.rebuild();
    return { kind: "backup", status: this.status() };
  }

  /** { format: "atlas-labels", places: { id: { name, types, address, uri, rating, ratingCount, city, state, country } } } */
  async importLabels(data) {
    let places = 0;
    for (const [id, p] of Object.entries(data.places || {})) {
      if (p.name || p.types) {
        this.google[id] = {
          ...(this.google[id] || {}),
          name: p.name ?? null, types: p.types ?? [], address: p.address ?? null, uri: p.uri ?? null,
          rating: p.rating ?? null, ratingCount: p.ratingCount ?? null,
        };
      }
      const present = Object.fromEntries(["city", "state", "country"].filter((k) => p[k]).map((k) => [k, p[k]]));
      if (Object.keys(present).length) this.labels[id] = applyPatch(this.labels[id], present);
      places++;
    }
    await this.persistAll();
    this.rebuild();
    return { kind: "labels", places, status: this.status() };
  }

  async persistAll() {
    await this.store.put("dataset", this.dataset.toJSON());
    await this.store.put("labels", this.labels);
    await this.store.put("google", this.google);
    await this.store.put("osm", this.osm);
    await this.store.put("saved", this.saved);
    await this.store.put("tripEdits", this.tripEdits);
    await this.store.put("settings", this.settingsValue);
  }

  async clearAll() {
    await this.store.clear();
    this.dataset = new Dataset();
    this.labels = {};
    this.google = {};
    this.osm = {};
    this.saved = [];
    this.tripEdits = {};
    this.settingsValue = { ...DEFAULT_SETTINGS };
    this.rebuild();
    return this.status();
  }
}
