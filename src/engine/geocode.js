// Offline reverse geocoder: city, state and country from coordinates, using
// the bundled GeoNames gazetteer (public/geo/places.json, CC BY 4.0).
// Deterministic and network-free, so the same coordinates always get the same
// labels and nobody has to fix states by hand.

import { haversineKm } from "./geo.js";

const CELL = 1; // degrees
const SEARCH_KM = 60;
const MAX_NEAREST_KM = 150; // farther than this from any town (at sea): no labels

/** How far a city's name reaches: ~8 km for a small town, ~25 km for a metro. */
const reachKm = (pop) => 8 + 6 * Math.log10(Math.max(pop, 1e4) / 1e4);

export class Geocoder {
  constructor(data) {
    this.d = data;
    this.grid = new Map();
    for (let i = 0; i < data.name.length; i++) {
      const key = cellKey(data.lat[i] / 1e4, data.lng[i] / 1e4);
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(i);
    }
    this.cache = new Map();
  }

  candidates(lat, lng, rings) {
    const cy = Math.floor(lat / CELL);
    const cx = Math.floor(lng / CELL);
    const out = [];
    for (let dy = -rings; dy <= rings; dy++) {
      for (let dx = -rings; dx <= rings; dx++) {
        const list = this.grid.get(`${cy + dy}:${wrapLng(cx + dx)}`);
        if (list) out.push(...list);
      }
    }
    return out;
  }

  /**
   * { city, state, country, countryCode } for a point.
   * State and country come from the nearest populated place (borders matter);
   * the city is the one that dominates the area, weighting population against
   * distance, so a suburb reads as its metro and a fort near Jaipur as Jaipur.
   */
  lookup(lat, lng) {
    if (lat == null || lng == null) return { city: null, state: null, country: null, countryCode: null };
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const d = this.d;
    let ids = this.candidates(lat, lng, 1);
    for (let rings = 2; !ids.length && rings <= 6; rings++) ids = this.candidates(lat, lng, rings);

    let nearest = -1;
    let nearestKm = Infinity;
    const scored = [];
    for (const i of ids) {
      const km = haversineKm(lat, lng, d.lat[i] / 1e4, d.lng[i] / 1e4);
      if (km < nearestKm) {
        nearestKm = km;
        nearest = i;
      }
      if (km <= SEARCH_KM) scored.push([i, km]);
    }
    let result = { city: null, state: null, country: null, countryCode: null };
    if (nearest >= 0 && nearestKm <= MAX_NEAREST_KM) {
      // Stay inside the nearest place's state; where GeoNames has no state
      // (city-states such as Singapore), inside its country.
      const sameArea = d.admin1[d.a1[nearest]]
        ? (i) => d.a1[i] === d.a1[nearest]
        : (i) => d.cc[i] === d.cc[nearest];
      let city = nearest;
      let best = -1;
      for (const [i, km] of scored) {
        if (!sameArea(i) || (i !== nearest && km > reachKm(d.pop[i]))) continue;
        const score = Math.max(d.pop[i], 1000) / (km + 2) ** 2;
        if (score > best) {
          best = score;
          city = i;
        }
      }
      result = {
        city: nearestKm <= SEARCH_KM ? d.name[city] : null,
        state: d.admin1[d.a1[nearest]] || null,
        country: d.countries[d.cc[nearest]] || null,
        countryCode: d.countryCodes[d.cc[nearest]] || null,
      };
    }
    this.cache.set(key, result);
    return result;
  }
}

function cellKey(lat, lng) {
  return `${Math.floor(lat / CELL)}:${wrapLng(Math.floor(lng / CELL))}`;
}

function wrapLng(cx) {
  const n = Math.round(360 / CELL);
  return ((cx % n) + n) % n;
}
