// Leaflet helpers shared by the trip, explore and planner maps.

import * as Leaflet from "leaflet";
import { esc } from "./util.js";

// The markercluster plugin extends a global `L`; give it a writable copy of the module.
export const L = { ...Leaflet };
window.L = L;
await import("leaflet.markercluster");

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
export const INDIA_VIEW = [[22, 79], 4];

export function createMap(el, { zoomPosition = "bottomright" } = {}) {
  const map = L.map(el, { zoomControl: false, worldCopyJump: true });
  L.control.zoom({ position: zoomPosition }).addTo(map);
  L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
  map.setView(...INDIA_VIEW);
  // Containers often change size when a view becomes visible.
  const observer = new ResizeObserver(() => map.invalidateSize());
  observer.observe(el);
  map.on("unload", () => observer.disconnect());
  // Leaflet ends a zoom animation on a 250 ms timer that doesn't check whether the
  // map was removed meanwhile, and views re-render right after an edit. End it first.
  const remove = map.remove.bind(map);
  map.remove = () => {
    map._animatingZoom = false;
    map.stop();
    return remove();
  };
  return map;
}

export function pinIcon(emoji, extraClass = "") {
  return L.divIcon({
    html: `<div class="pin-badge ${extraClass}">${emoji}</div>`,
    className: "pin",
    iconSize: [30, 30],
    iconAnchor: [15, 28],
    popupAnchor: [0, -26],
  });
}

export function numberIcon(n, color, dim = false) {
  const size = dim ? 14 : 24;
  return L.divIcon({
    html: `<div class="stop-pin${dim ? " dim" : ""}" style="--pc:${color}">${dim ? "" : esc(n)}</div>`,
    className: "pin",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

export function stayIcon() {
  return L.divIcon({
    html: '<div class="stay-pin">\u{1F6CF}️</div>',
    className: "pin",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

/** CSS custom property value (e.g. "var(--c1)") -> concrete color Leaflet can use for SVG strokes. */
export function cssColor(value) {
  const m = /^var\((--[\w-]+)\)$/.exec(value || "");
  if (!m) return value;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#0f9d8f";
}

/** Great-circle-ish arc for flights so long hops read as flights, not roads. */
export function arc(from, to, steps = 32) {
  const [lat1, lng1] = from;
  const [lat2, lng2] = to;
  const dist = Math.hypot(lat2 - lat1, lng2 - lng1);
  const bulge = Math.min(dist * 0.18, 8);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lat = lat1 + (lat2 - lat1) * t;
    const lng = lng1 + (lng2 - lng1) * t;
    const off = Math.sin(Math.PI * t) * bulge;
    // offset perpendicular to the chord
    pts.push([lat + (off * (lng2 - lng1)) / (dist || 1) * 0.6, lng - (off * (lat2 - lat1)) / (dist || 1) * 0.6]);
  }
  return pts;
}

/** Fit to points; `left`/`bottom` reserve room for panels floating over the map. */
export function fit(map, latlngs, maxZoom = 13, left = 0, bottom = 0) {
  const opts = { maxZoom, paddingTopLeft: [left + 24, 24], paddingBottomRight: [24, bottom + 24] };
  if (latlngs.length === 1) map.setView(latlngs[0], Math.min(maxZoom, 13));
  else if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs), opts);
}
