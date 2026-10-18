import { dataVersion, query } from "../../data/client.js";
import { createMap, fit, L, pinIcon } from "../map.js";
import { wireRename } from "../rename.js";
import {
  $, esc, fmtDate, fmtInt, fmtMinutes, isMobile, KINDS, kindMeta, localDate, mapsLink, plural, SOURCES, THEMES,
  themeIcon, themeLabel,
} from "../util.js";

const st = {
  el: null, map: null, cluster: null, places: [], markers: new Map(), version: -1,
  q: "", kinds: new Set(["explored"]), themes: new Set(), year: "", tripsOnly: false, sort: "recent", focused: null,
};

export async function show(el, params) {
  if (st.el !== el) mount(el);
  if (st.version !== dataVersion()) await load();
  if (params[0] === "theme" && THEMES[params[1]]) {
    st.themes = new Set([params[1]]);
    st.kinds = new Set(["explored"]);
    syncControls();
    refresh(true);
  } else if (params[0] === "kind" && KINDS[params[1]]) {
    st.kinds = new Set([params[1]]);
    st.themes.clear();
    syncControls();
    refresh(true);
  } else if (params[0] === "place" && params[1]) {
    const p = st.places.find((x) => x.place_id === params[1]);
    if (p && !st.kinds.has(p.kind)) {
      st.kinds.add(p.kind);
      syncControls();
      refresh();
    }
    focusPlace(params[1]);
  }
  setTimeout(() => st.map.invalidateSize(), 50);
}

function mount(el) {
  st.el = el;
  el.innerHTML = `<div id="explore-map"></div>
    <aside class="map-panel" id="map-panel">
      <button type="button" class="panel-grab" aria-label="Expand or collapse the list"></button>
      <div class="panel-top">
        <div class="panel-summary"><span id="map-summary">Loading places…</span>
          <div class="seg"><button type="button" data-sort="recent" class="active">Recent</button><button type="button" data-sort="visits">Most visited</button></div></div>
        <input class="input" type="search" id="map-q" placeholder="Search places, cities, states" aria-label="Search places">
        <div class="chips" id="map-kinds" aria-label="Kinds of place"></div>
        <div class="chips" id="map-themes" aria-label="Themes"></div>
        <div class="row">
          <select class="select" id="map-year" aria-label="Year"><option value="">Any year</option></select>
          <label class="toggle"><input type="checkbox" id="map-trips"> On trips only</label>
          <label class="toggle"><input type="checkbox" id="map-oneoffs"> One-off stops</label>
        </div>
      </div>
      <div class="panel-list" id="map-list"></div>
    </aside>
    <button type="button" class="map-fab" id="map-fit" title="Show all" aria-label="Zoom to all places" style="bottom:${isMobile() ? 136 : 24}px">⤢</button>`;

  st.map = createMap($("#explore-map"), { zoomPosition: "topright" });
  st.cluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 48, showCoverageOnHover: false });
  st.map.addLayer(st.cluster);
  wireRename(st.map.getContainer());
  wire();
}

async function load() {
  let data;
  try {
    data = await query("places", { includeHidden: false });
  } catch (e) {
    $("#map-list").innerHTML = `<div class="notice err" style="margin:10px">${esc(e.message)}</div>`;
    $("#map-summary").textContent = "Could not load places";
    return;
  }
  const first = st.version === -1;
  st.version = dataVersion();
  st.places = data.places.filter((p) => p.latitude != null);

  const years = [...new Set(st.places.flatMap((p) => p.years))].sort().reverse();
  $("#map-year").innerHTML = `<option value="">Any year</option>${years.map((y) => `<option ${String(y) === st.year ? "selected" : ""}>${y}</option>`).join("")}`;
  renderChips();
  refresh(first);
}

function renderChips() {
  const kindCounts = new Map();
  const themeCounts = new Map();
  for (const p of st.places) {
    if (p.oneoff && !st.oneoffs) continue;
    kindCounts.set(p.kind, (kindCounts.get(p.kind) || 0) + 1);
    if (st.kinds.has(p.kind)) themeCounts.set(p.theme, (themeCounts.get(p.theme) || 0) + 1);
  }
  $("#map-kinds").innerHTML = Object.keys(KINDS).filter((k) => kindCounts.has(k)).map((k) =>
    `<button type="button" class="chip ${st.kinds.has(k) ? "active" : ""}" data-kind="${k}" title="${esc(KINDS[k].hint)}">${kindMeta(k).icon} ${esc(KINDS[k].label)}<span class="n">${kindCounts.get(k)}</span></button>`).join("");
  // "Other" (no name or type yet) isn't a useful filter, and a single theme
  // would only repeat the kind filter.
  const themes = Object.keys(THEMES).filter((t) => t !== "other" && themeCounts.has(t));
  $("#map-themes").innerHTML = themes.length > 1 ? themes.map((t) =>
    `<button type="button" class="chip ${st.themes.has(t) ? "active" : ""}" data-theme="${t}">${themeIcon(t)} ${esc(themeLabel(t))}<span class="n">${themeCounts.get(t)}</span></button>`).join("") : "";
  $("#map-themes").hidden = themes.length <= 1;
}

function wire() {
  const panel = $("#map-panel");
  panel.querySelector(".panel-grab").addEventListener("click", () => panel.classList.toggle("open"));
  $("#map-q").addEventListener("input", (e) => {
    st.q = e.target.value;
    refresh();
  });
  $("#map-q").addEventListener("focus", () => isMobile() && panel.classList.add("open"));
  $("#map-year").addEventListener("change", (e) => {
    st.year = e.target.value;
    refresh(true);
  });
  $("#map-trips").addEventListener("change", (e) => {
    st.tripsOnly = e.target.checked;
    refresh(true);
  });
  $("#map-oneoffs").addEventListener("change", (e) => {
    st.oneoffs = e.target.checked;
    renderChips();
    refresh();
  });
  $("#map-kinds").addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]");
    if (!b) return;
    const k = b.dataset.kind;
    if (st.kinds.has(k) && st.kinds.size > 1) st.kinds.delete(k);
    else st.kinds.add(k);
    st.themes.clear();
    renderChips();
    refresh(true);
  });
  $("#map-themes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme]");
    if (!b) return;
    const t = b.dataset.theme;
    st.themes.has(t) ? st.themes.delete(t) : st.themes.add(t);
    syncControls();
    refresh(true);
  });
  panel.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => {
    st.sort = b.dataset.sort;
    panel.querySelectorAll("[data-sort]").forEach((x) => x.classList.toggle("active", x === b));
    renderList(filtered());
  }));
  $("#map-list").addEventListener("click", (e) => {
    const row = e.target.closest("[data-place]");
    if (row) focusPlace(row.dataset.place);
    if (e.target.closest("[data-back]")) {
      st.focused = null;
      renderList(filtered());
    }
  });
  $("#map-fit").addEventListener("click", () => fitAll());
}

function syncControls() {
  renderChips();
  $("#map-trips").checked = st.tripsOnly;
}

function filtered() {
  const q = st.q.trim().toLowerCase();
  return st.places.filter((p) =>
    st.kinds.has(p.kind) &&
    (!st.themes.size || st.themes.has(p.theme)) &&
    (!st.year || p.years.includes(Number(st.year))) &&
    (!st.tripsOnly || p.trip_visits > 0) &&
    (st.oneoffs || !p.oneoff || q) &&
    (!q || [p.name, p.city, p.state, p.country, p.category].filter(Boolean).join(" ").toLowerCase().includes(q)));
}

function refresh(refit = false) {
  const list = filtered();
  st.cluster.clearLayers();
  st.markers.clear();
  const layers = [];
  for (const p of list) {
    const m = L.marker([p.latitude, p.longitude], { icon: pinIcon(themeIcon(p.theme), p.kind === "explored" ? "" : `k-${p.kind}`), title: p.name });
    m.bindPopup(() => popup(p));
    m.on("click", () => showDetail(p.place_id));
    st.markers.set(p.place_id, m);
    layers.push(m);
  }
  st.cluster.addLayers(layers);
  const visits = list.reduce((s, p) => s + p.visits, 0);
  $("#map-summary").innerHTML = `<strong>${fmtInt(list.length)}</strong> places · <strong>${fmtInt(visits)}</strong> visits`;
  if (!st.focused) renderList(list);
  if (refit) fitAll(list, true);
}

/**
 * Frame the places. The first view frames where most of them are (the country
 * with the most places, trimming stray far-off points), so a few years abroad
 * don't zoom the map out to half the world; the "show all" button frames everything.
 */
function fitAll(list = filtered(), main = false) {
  let pts = list.map((p) => [p.latitude, p.longitude]);
  if (main && list.length > 20) {
    const byCountry = new Map();
    for (const p of list) byCountry.set(p.country, (byCountry.get(p.country) || 0) + 1);
    const top = [...byCountry.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const inTop = list.filter((p) => p.country === top);
    const lats = inTop.map((p) => p.latitude).sort((a, b) => a - b);
    const lngs = inTop.map((p) => p.longitude).sort((a, b) => a - b);
    const q = (xs, f) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(f * (xs.length - 1))))];
    pts = [[q(lats, 0.03), q(lngs, 0.03)], [q(lats, 0.97), q(lngs, 0.97)]];
  }
  fit(st.map, pts, 12, isMobile() ? 0 : 392, isMobile() ? 118 : 0);
  if (isMobile()) $("#map-panel").classList.remove("open");
}

function renderList(list) {
  const sorted = [...list].sort(st.sort === "visits"
    ? (a, b) => b.visits - a.visits || (b.last_visit || "").localeCompare(a.last_visit || "")
    : (a, b) => (b.last_visit || "").localeCompare(a.last_visit || ""));
  $("#map-list").innerHTML = sorted.length
    ? sorted.slice(0, 300).map((p) => `<button type="button" class="place-row" data-place="${esc(p.place_id)}">
        <span class="ico" aria-hidden="true">${themeIcon(p.theme)}</span>
        <span><span class="nm${p.named ? "" : " unnamed"}">${esc(p.name)}</span><div class="sub">${esc([p.city, p.state].filter(Boolean).join(", "))} · ${esc(fmtDate(localDate(p.last_visit)))}</div></span>
        <span class="n">${p.visits}×</span>
      </button>`).join("") + (sorted.length > 300 ? `<p class="muted" style="padding:8px">Showing 300 of ${fmtInt(sorted.length)}. Search or filter to narrow down.</p>` : "")
    : '<div class="empty"><span class="big">\u{1F5FA}️</span>No places match.</div>';
}

function popup(p) {
  return `<h3 data-rename-target>${esc(p.name)}</h3>
    <div class="pm">${themeIcon(p.theme)} ${esc(themeLabel(p.theme))}${p.city ? ` · ${esc(p.city)}` : ""}${p.state ? `, ${esc(p.state)}` : ""}</div>
    <div class="pm">${kindMeta(p.kind).icon} ${esc(kindMeta(p.kind).label)}${p.approx ? " · name approximate" : ""}</div>
    ${p.rating ? `<div class="pm">★ ${p.rating}${p.user_rating_count ? ` (${fmtInt(p.user_rating_count)})` : ""}</div>` : ""}
    <div class="pm" style="margin-top:4px"><strong>${plural(p.visits, "visit")}</strong>${p.trip_visits ? ` · ${p.trip_visits} on trips` : ""}</div>
    <div class="pm">First ${esc(fmtDate(localDate(p.first_visit)))}${p.visits > 1 ? ` · last ${esc(fmtDate(localDate(p.last_visit)))}` : ""}</div>
    <button type="button" class="pl" data-rename="${esc(p.place_id)}" data-current="${esc(p.named ? p.name : "")}">Rename</button>
    <a class="pl" href="#/places/${encodeURIComponent(p.place_id)}">Edit</a>
    <a class="pl" target="_blank" rel="noopener" href="${esc(p.google_maps_uri || mapsLink(p.latitude, p.longitude, p.named ? p.name : "", p.place_id))}">Google Maps ↗</a>`;
}

function focusPlace(placeId) {
  const p = st.places.find((x) => x.place_id === placeId);
  if (!p) return;
  const m = st.markers.get(placeId);
  if (isMobile()) $("#map-panel").classList.remove("open");
  if (m) st.cluster.zoomToShowLayer(m, () => m.openPopup());
  else st.map.setView([p.latitude, p.longitude], 15);
  showDetail(placeId);
}

async function showDetail(placeId) {
  st.focused = placeId;
  const list = $("#map-list");
  list.innerHTML = '<div class="spinner">Loading</div>';
  let d;
  try {
    d = await query("place", placeId);
  } catch (e) {
    list.innerHTML = `<div class="notice err" style="margin:10px">${esc(e.message)}</div>`;
    return;
  }
  if (st.focused !== placeId || !d) return;
  list.innerHTML = `<div class="place-detail">
    <button type="button" class="link-btn" data-back style="justify-self:start">← All places</button>
    <h3>${themeIcon(d.theme)} ${esc(d.name)}</h3>
    <div class="muted">${esc(d.formatted_address || [d.city, d.state, d.country].filter(Boolean).join(", "))}</div>
    <div class="row">
      <span class="badge soft">${kindMeta(d.kind).icon} ${esc(kindMeta(d.kind).label)}</span>
      ${d.name_source ? `<span class="badge soft">Name: ${esc(SOURCES[d.name_source])}</span>` : ""}
    </div>
    <div class="row">
      <a class="btn small primary" href="#/places/${encodeURIComponent(d.place_id)}">Edit label</a>
      <a class="btn small outline" target="_blank" rel="noopener" href="${esc(d.google_maps_uri || mapsLink(d.latitude, d.longitude, d.named ? d.name : ""))}">Google Maps ↗</a>
    </div>
    <div class="section-title">${plural(d.visits.length, "visit")}</div>
    <ul class="visit-list">${d.visits.map((v) => `<li>
      <span>${esc(fmtDate(localDate(v.start_time)))}${v.journey_id ? ` · <a href="#/trips/${v.journey_id}">${esc(v.journey_title || "trip")}</a>` : ""}</span>
      <span class="muted">${esc(fmtMinutes(v.duration_minutes))}</span></li>`).join("")}</ul>
  </div>`;
}
