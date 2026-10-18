// Free, keyless place names from OpenStreetMap via the Overpass API.
// Approximate by nature: the visit's coordinates are matched to the most
// meaningful named feature nearby, and the app marks these names as such.

import { osmSignificance } from "./classify.js";
import { haversineKm } from "./geo.js";

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
export const OSM_VERSION = 3; // 2: neighbourhood and landmark; 3: names only for what's right there
const RADIUS_M = 120;
const NEAR_M = 800; // a landmark this close gives an unnamed place a label ("Near Hampi temple")
const AREA_M = 2500; // the neighbourhood, suburb or village around a place
const BATCH = 20;
const AREA_PLACES = "^(suburb|neighbourhood|quarter|village|hamlet|town|locality)$";
const LANDMARKS = "^(attraction|museum|viewpoint|theme_park|zoo|gallery)$";

export function overpassQuery(points, radius = RADIUS_M) {
  const parts = points.map(([lat, lng]) => {
    const at = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    return `nwr(around:${radius},${at})[name];`
      + `node(around:${AREA_M},${at})[place~"${AREA_PLACES}"][name];`
      + `nwr(around:${NEAR_M},${at})[name][tourism~"${LANDMARKS}"];`
      + `nwr(around:${NEAR_M},${at})[name][historic];`;
  }).join("");
  return `[out:json][timeout:120];(${parts});out center tags;`;
}

const coords = (el) => [el.lat ?? el.center?.lat, el.lon ?? el.center?.lon];
const nameOf = (tags) => tags["name:en"] || tags.name;

/** The neighbourhood (or suburb, village) a point is in: the nearest such place node. */
export function pickArea(lat, lng, elements) {
  let best = null;
  for (const el of elements) {
    if (!el.tags?.place || !el.tags.name || !new RegExp(AREA_PLACES).test(el.tags.place)) continue;
    const [eLat, eLng] = coords(el);
    if (eLat == null) continue;
    const m = haversineKm(lat, lng, eLat, eLng) * 1000;
    // Prefer the finer-grained neighbourhood when it is about as close as the suburb.
    const score = m * (/^(neighbourhood|quarter|locality)$/.test(el.tags.place) ? 0.8 : 1);
    if (m <= AREA_M && (!best || score < best.score)) best = { score, name: nameOf(el.tags) };
  }
  return best?.name ?? null;
}

/** The nearest landmark within NEAR_M, for places nothing names directly. */
export function pickLandmark(lat, lng, elements) {
  let best = null;
  for (const el of elements) {
    const tags = el.tags || {};
    if (!tags.name || !(tags.historic || new RegExp(LANDMARKS).test(tags.tourism || ""))) continue;
    const [eLat, eLng] = coords(el);
    if (eLat == null) continue;
    const m = haversineKm(lat, lng, eLat, eLng) * 1000;
    if (m <= NEAR_M && (!best || m < best.m)) best = { m, name: nameOf(tags) };
  }
  return best?.name ?? null;
}

/** Everything OpenStreetMap says about a point: a name if something is right there, else a label. */
export function describe(lat, lng, elements) {
  const feature = pickFeature(lat, lng, elements);
  const area = pickArea(lat, lng, elements);
  const near = feature ? null : pickLandmark(lat, lng, elements);
  return { ...(feature || {}), area, near, v: OSM_VERSION };
}

/**
 * Best named feature for a point: sights before restaurants before buildings,
 * nearer before farther. Named roads and other unclassified features never win.
 */
export function pickFeature(lat, lng, elements, radius = RADIUS_M) {
  let best = null;
  for (const el of elements) {
    const tags = el.tags || {};
    if (!tags.name) continue;
    const eLat = el.lat ?? el.center?.lat;
    const eLng = el.lon ?? el.center?.lon;
    if (eLat == null) continue;
    const meters = haversineKm(lat, lng, eLat, eLng) * 1000;
    if (meters > radius) continue;
    let sig = osmSignificance(tags);
    if (sig === 0) {
      if (!tags.building || meters > 20) continue;
      sig = 0.5;
    }
    // A name is only claimed for what's right there: the shop next door or the
    // temple down the road is not where you were. Big sights (forts, parks) are
    // measured from their centre, so they get more room. Farther things only
    // label the place ("Near …"), never name it.
    if (meters > (sig >= 3 ? 120 : sig >= 2 ? 60 : 30)) continue;
    // Big sights (forts, parks) sit far from their centre point: be generous with them.
    const score = sig * 100 - meters / (sig >= 2 ? 3 : 1);
    if (!best || score > best.score) best = { score, name: nameOf(tags), tags, distance: Math.round(meters) };
  }
  if (!best) return null;
  const { score, ...rest } = best;
  return rest;
}

/**
 * Look up places in batches. `places` = [{ placeId, lat, lng }].
 * Calls onResult(placeId, result|null) as it goes; null means "nothing found"
 * (cached too, so it isn't asked again). Respects the public server: one
 * request at a time with a pause between batches.
 */
export async function enrichFromOsm(places, { fetchFn = fetch, onResult, onProgress, signal, pauseMs = 1500, endpoint = OVERPASS_URL } = {}) {
  let done = 0;
  for (let i = 0; i < places.length; i += BATCH) {
    if (signal?.aborted) break;
    const batch = places.slice(i, i + BATCH);
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(overpassQuery(batch.map((p) => [p.lat, p.lng])))}`,
      signal,
    });
    if (res.status === 429 || res.status === 504) {
      // Server busy: wait and retry this batch.
      await new Promise((r) => setTimeout(r, pauseMs * 4));
      i -= BATCH;
      continue;
    }
    if (!res.ok) throw new Error(`OpenStreetMap lookup failed (HTTP ${res.status})`);
    const { elements = [] } = await res.json();
    for (const p of batch) onResult?.(p.placeId, describe(p.lat, p.lng, elements));
    done += batch.length;
    onProgress?.(done, places.length);
    if (i + BATCH < places.length) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return done;
}
