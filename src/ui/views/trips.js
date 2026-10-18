import { mutate, query } from "../../data/client.js";
import { wireRename } from "../rename.js";
import { stackedBar } from "../charts.js";
import { arc, createMap, cssColor, fit, L, numberIcon } from "../map.js";
import {
  $, bindTips, toast, dayColor, esc, fmtInt, fmtKm, fmtMinutes, fmtWeekday, isMobile, localDate,
  localTime, mapsLink, modeMeta, plural, themeIcon, themeLabel,
} from "../util.js";
import { tripCard } from "./overview.js";

let listState = { q: "", year: "", kind: "", hidden: false };
let detailMap = null;

let renderSeq = 0; // an edit and a navigation can both re-render; the latest wins

export async function show(el, params) {
  hideMap();
  const seq = ++renderSeq;
  if (params[0]) return showDetail(el, params[0], seq);
  return showList(el, seq);
}

function hideMap() {
  if (detailMap) {
    detailMap.remove();
    detailMap = null;
  }
}

// ---- list ---------------------------------------------------------------------------

async function showList(el, seq) {
  el.innerHTML = '<div class="page"><div class="spinner">Loading trips</div></div>';
  let journeys;
  let lens;
  try {
    ({ journeys, lens } = await query("journeys", { includeHidden: true }));
    if (seq !== renderSeq) return;
  } catch (e) {
    el.innerHTML = `<div class="page"><div class="notice err">${esc(e.message)}</div></div>`;
    return;
  }
  const hiddenCount = journeys.filter((j) => j.hidden).length;
  const visible = journeys.filter((j) => !j.hidden);
  const years = [...new Set(journeys.map((j) => j.start_date.slice(0, 4)))];
  const days = visible.reduce((s, j) => s + j.nights + 1, 0);

  el.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Trips</h1>
      <p>${plural(visible.length, "trip")} · ${plural(days, "day")} away · ${lens.awayKm} km or more from home
        · <a href="#/settings">change</a></p></div></div>
    ${journeys.length ? `<div class="filters">
      <input class="input grow" type="search" placeholder="Search trips, cities, states" value="${esc(listState.q)}" data-f="q" aria-label="Search trips">
      <select class="select" data-f="year" aria-label="Year"><option value="">All years</option>${years.map((y) =>
        `<option ${y === listState.year ? "selected" : ""}>${y}</option>`).join("")}</select>
      <div class="seg">${[["", "All"], ["overnight", "Overnight"], ["day_trip", "Day trips"]].map(([k, l]) =>
        `<button type="button" data-kind="${k}" class="${k === listState.kind ? "active" : ""}">${l}</button>`).join("")}</div>
      ${hiddenCount ? `<label class="toggle"><input type="checkbox" data-f="hidden" ${listState.hidden ? "checked" : ""}> Hidden (${hiddenCount})</label>` : ""}
    </div>` : ""}
    <div id="trip-groups"></div>
  </div>`;

  const draw = () => {
    const q = listState.q.trim().toLowerCase();
    const shown = journeys.filter((j) =>
      j.hidden === listState.hidden &&
      (!listState.year || j.start_date.startsWith(listState.year)) &&
      (!listState.kind || j.kind === listState.kind) &&
      (!q || [j.title, j.primary_state, j.primary_country, ...j.cities.map((c) => c.city), ...j.states]
        .filter(Boolean).join(" ").toLowerCase().includes(q)));
    $("#trip-groups").innerHTML = journeys.length ? groups(shown) : emptyTrips();
  };
  el.querySelector('[data-f="q"]')?.addEventListener("input", (e) => { listState.q = e.target.value; draw(); });
  el.querySelector('[data-f="year"]')?.addEventListener("change", (e) => { listState.year = e.target.value; draw(); });
  el.querySelector('[data-f="hidden"]')?.addEventListener("change", (e) => { listState.hidden = e.target.checked; draw(); });
  el.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => {
    listState.kind = b.dataset.kind;
    el.querySelectorAll("[data-kind]").forEach((x) => x.classList.toggle("active", x === b));
    draw();
  }));
  draw();
}

function groups(journeys) {
  if (!journeys.length) return '<div class="empty"><span class="big">\u{1F50E}</span>No trips match these filters.</div>';
  const byYear = new Map();
  for (const j of journeys) {
    const y = j.start_date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(j);
  }
  return [...byYear.entries()].map(([year, list]) => {
    const days = list.reduce((s, j) => s + j.nights + 1, 0);
    const km = list.reduce((s, j) => s + (j.distance_km || 0), 0);
    return `<section class="year-group">
      <div class="year-head"><h2>${year}</h2><span>${plural(list.length, "trip")} · ${plural(days, "day")} · ${fmtKm(km)}</span></div>
      <div class="trip-grid">${list.map(tripCard).join("")}</div>
    </section>`;
  }).join("");
}

function emptyTrips() {
  return `<div class="card empty"><span class="big">\u{1F9F3}</span>
    <p><strong>No trips under your current rules.</strong></p>
    <p class="muted" style="margin-top:6px">A trip is time spent far enough from home. Try a shorter distance in
    <a href="#/settings">Settings</a>.</p></div>`;
}

// ---- detail -------------------------------------------------------------------------

async function showDetail(el, id, seq) {
  el.innerHTML = '<div class="page"><div class="spinner">Loading trip</div></div>';
  let j;
  try {
    j = await query("journey", Number(id));
    if (seq !== renderSeq) return;
    if (!j) throw new Error("This trip isn't there any more. Changing the trip rules can merge or split trips.");
  } catch (e) {
    el.innerHTML = `<div class="page"><div class="crumbs"><a href="#/trips">← All trips</a></div>
      <div class="notice err" style="margin-top:12px">${esc(e.message)}</div></div>`;
    return;
  }

  const dayList = buildDays(j);
  // States, plus the country when it is not the one most trips happen in.
  const states = [...new Set([...j.states, ...j.countries.filter((c) => c !== j.home_country)])];
  const transportParts = Object.entries(j.transport)
    .filter(([, km]) => km >= 0.5)
    .map(([mode, km]) => ({ label: modeMeta(mode).label, value: km, display: fmtKm(km), color: modeMeta(mode).color }));

  el.innerHTML = `<div class="page">
    <div class="detail-head">
      <div class="crumbs">
        <a href="#/trips">← All trips</a>
        <span class="row">
          ${j.prev ? `<a href="#/trips/${j.prev.id}" title="${esc(j.prev.title)}">‹ Earlier</a>` : ""}
          ${j.next ? `<a href="#/trips/${j.next.id}" title="${esc(j.next.title)}">Later ›</a>` : ""}
        </span>
      </div>
      <div class="title-row">
        <h1 id="trip-title">${esc(j.title)}</h1>
        <button type="button" class="btn small ghost" data-rename>Rename</button>
        <button type="button" class="btn small ghost" data-hide>${j.hidden ? "Show in trips" : "Not a trip"}</button>
      </div>
      ${j.hidden ? '<div class="notice">Hidden: this stretch is left out of your trips and stats.</div>' : ""}
      <div class="when">${esc(j.nights ? `${fmtWeekday(j.start_date)} – ${fmtWeekday(j.end_date)} ${j.end_date.slice(0, 4)}` : `${fmtWeekday(j.start_date)} ${j.start_date.slice(0, 4)}`)} · ${j.nights ? plural(j.nights, "night") : "Day trip"}</div>
      <div class="fact-row">
        <div class="fact"><div class="v">${esc(fmtKm(j.distance_km))}</div><div class="l">travelled</div></div>
        <div class="fact"><div class="v">${esc(fmtKm(j.max_distance_km))}</div><div class="l">farthest from home</div></div>
        <div class="fact"><div class="v">${fmtInt(j.place_count)}</div><div class="l">places</div></div>
        ${states.length ? `<div class="fact"><div class="v">${esc(states.slice(0, 2).join(", "))}${states.length > 2 ? "…" : ""}</div><div class="l">${states.length > 1 ? "regions" : "region"}</div></div>` : ""}
      </div>
    </div>
    <div class="trip-detail">
      <div class="map-col stack">
        <section class="card map-card">
          <div class="map-tools"><div class="chips scroll" id="day-chips"></div></div>
          <div class="trip-map" id="trip-map"></div>
        </section>
        ${transportParts.length ? `<section class="card"><div class="card-head"><h2>How you got around</h2></div>${stackedBar(transportParts)}</section>` : ""}
      </div>
      <section class="card">
        <div class="card-head"><h2>Itinerary</h2><span class="sub">tap a stop to see it on the map</span></div>
        ${dayList.map((d, i) => dayBlock(d, i, dayList.length)).join("")}
      </section>
    </div>
  </div>`;

  bindTips(el);
  el.querySelector("[data-rename]").addEventListener("click", () => renameTrip(j));
  el.querySelector("[data-hide]").addEventListener("click", async () => {
    await mutate("setTripEdit", j.id, { hidden: !j.hidden });
    toast(j.hidden ? "Back in your trips" : "Hidden from trips and stats", "ok");
  });

  drawMap(j, dayList);
  el.querySelectorAll("[data-focus]").forEach((b) => b.addEventListener("click", () => focusStop(Number(b.dataset.focus))));
  wireRename(el.querySelector(".trip-detail"));
}

/** Group visits by local date and attach the travel legs that lead into each stop. */
function buildDays(j) {
  // Timestamps carry different offsets abroad, so compare instants, not strings.
  const acts = j.activities || [];
  let a = 0;
  const days = new Map();
  let prevEnd = -Infinity;
  j.visits.forEach((v, idx) => {
    const legs = [];
    const start = Date.parse(v.start_time);
    while (a < acts.length && Date.parse(acts[a].start_time) < start) {
      if (Date.parse(acts[a].start_time) >= prevEnd) legs.push(acts[a]);
      a++;
    }
    prevEnd = Date.parse(v.end_time);
    const date = localDate(v.start_time);
    if (!days.has(date)) days.set(date, []);
    // Minor stops (routine places, or a few minutes somewhere) get no number and
    // are folded together in the itinerary, so the trip's real stops stand out.
    days.get(date).push({ ...v, idx, legs, minor: Boolean(v.routine) || v.duration_minutes < MINOR_MINUTES });
  });
  return [...days.entries()].map(([date, stops]) => ({ date, stops }));
}

function legLine(legs) {
  const km = legs.reduce((s, l) => s + (l.distance_meters || 0), 0) / 1000;
  if (km < 2) return "";
  const main = legs.reduce((best, l) => ((l.distance_meters || 0) > (best.distance_meters || 0) ? l : best), legs[0]);
  const minutes = legs.reduce((s, l) => s + (Date.parse(l.end_time) - Date.parse(l.start_time)) / 60000, 0);
  const m = modeMeta(main.mode);
  return `<li class="leg">${m.icon} ${esc(fmtKm(km))} · ${esc(fmtMinutes(minutes))}</li>`;
}

const MINOR_MINUTES = 20;

function stopItem(s, n) {
  return `<li class="stop${s.minor ? " routine" : ""}">
    ${n ? `<span class="num" aria-hidden="true">${n}</span>` : ""}
    <span class="t">${esc(localTime(s.start_time))}</span>
    <span class="nm"><span class="nm-line" data-rename-target><button type="button" data-focus="${s.idx}">${n ? `<span class="sr-only">Stop ${n}: </span>` : ""}${esc(s.name || "Unnamed stop")}</button>
        ${s.place_id ? `<button type="button" class="rename-btn" data-rename="${esc(s.place_id)}" data-current="${esc(s.named ? s.name : "")}" aria-label="Rename ${esc(s.name || "this stop")}" title="Rename">✎</button>` : ""}</span>
      <span class="sub">${s.routine ? "stop" : `${themeIcon(s.theme)} ${esc(themeLabel(s.theme))}`}${s.city ? ` · ${esc(s.city)}` : ""}</span></span>
    <span class="dur">${esc(fmtMinutes(s.duration_minutes))}</span>
  </li>`;
}

function dayBlock(day, i, total) {
  const color = dayColor(i, total);
  // Number the main stops as the map does; fold runs of minor stops in one town.
  const parts = [];
  let n = 0;
  for (let k = 0; k < day.stops.length; k++) {
    const s = day.stops[k];
    if (!s.minor) {
      parts.push(legLine(s.legs) + stopItem(s, ++n));
      continue;
    }
    let end = k;
    while (end + 1 < day.stops.length && day.stops[end + 1].minor && day.stops[end + 1].city === s.city) end++;
    const run = day.stops.slice(k, end + 1);
    if (run.length < 2) {
      parts.push(legLine(s.legs) + stopItem(s, 0));
      continue;
    }
    const minutes = run.reduce((m, x) => m + (x.duration_minutes || 0), 0);
    parts.push(`${legLine(s.legs)}<li class="stop group"><details>
      <summary><span class="t">${esc(localTime(s.start_time))}</span>
        <span class="nm">${run.length} short stops${s.city ? ` in ${esc(s.city)}` : ""}<span class="sub">tap to list them</span></span>
        <span class="dur">${esc(fmtMinutes(minutes))}</span></summary>
      <ul class="stops inner">${run.map((x, j) => (j ? legLine(x.legs) : "") + stopItem(x, 0)).join("")}</ul>
    </details></li>`);
    k = end;
  }
  return `<div class="day-block">
    <div class="day-label"><span class="dot" style="background:${color}"></span>Day ${i + 1}<span class="date">${esc(fmtWeekday(day.date))}</span></div>
    <ul class="stops" style="--pc:${color}">${parts.join("")}</ul>
  </div>`;
}

let markers = [];

function drawMap(j, days) {
  detailMap = createMap($("#trip-map"));
  const pathLayer = L.layerGroup().addTo(detailMap);
  const stopLayer = L.layerGroup().addTo(detailMap);
  const brand = cssColor("var(--brand)");
  markers = [];

  // Path is a list of recorded segments; older data stored one flat line.
  const segments = Array.isArray(j.path?.[0]?.[0]) ? j.path : j.path?.length ? [j.path] : [];
  if (segments.length) {
    L.polyline(segments, { color: brand, weight: 3, opacity: 0.75, lineJoin: "round" }).addTo(pathLayer);
  } else {
    const pts = j.visits.filter((v) => v.latitude != null).map((v) => [v.latitude, v.longitude]);
    if (pts.length > 1) L.polyline(pts, { color: brand, weight: 2.5, opacity: 0.6 }).addTo(pathLayer);
  }
  for (const a of j.activities || []) {
    if (a.mode !== "flight" || a.start_lat == null) continue;
    L.polyline(arc([a.start_lat, a.start_lng], [a.end_lat, a.end_lng]), {
      color: cssColor(modeMeta("flight").color), weight: 2, opacity: 0.85, dashArray: "2 7", lineCap: "round",
    }).addTo(pathLayer);
  }

  // Frame the destination, not the drive to the home airport.
  const awayFromHome = (s) => j.home_lat == null || Math.hypot(s.latitude - j.home_lat, (s.longitude - j.home_lng) * Math.cos(j.home_lat * Math.PI / 180)) * 111 > 50;
  const drawStops = (only) => {
    stopLayer.clearLayers();
    markers = [];
    const pts = [];
    const away = [];
    days.forEach((day, i) => {
      if (only != null && only !== i) return;
      const color = cssColor(dayColor(i, days.length));
      let n = 0;
      for (const s of day.stops) {
        if (s.latitude == null) continue;
        if (!s.minor) n++;
        const m = L.marker([s.latitude, s.longitude], {
          icon: numberIcon(n, color, s.minor),
          zIndexOffset: s.minor ? -100 : 0,
        }).bindPopup(`<h3>${esc(s.name || "Unnamed stop")}</h3>
          <div class="pm">Day ${i + 1} · ${esc(localTime(s.start_time))} · ${esc(fmtMinutes(s.duration_minutes))}</div>
          ${s.city ? `<div class="pm">${esc([s.city, s.state].filter(Boolean).join(", "))}</div>` : ""}
          <a class="pl" target="_blank" rel="noopener" href="${esc(s.google_maps_uri || mapsLink(s.latitude, s.longitude, s.name, s.place_id))}">Google Maps ↗</a>
          <a class="pl" href="#/places/${encodeURIComponent(s.place_id)}">Edit place</a>`);
        stopLayer.addLayer(m);
        markers[s.idx] = m;
        pts.push([s.latitude, s.longitude]);
        if (awayFromHome(s)) away.push([s.latitude, s.longitude]);
      }
    });
    fit(detailMap, away.length ? away : pts.length ? pts : segments.flat(), 14);
  };

  const chips = $("#day-chips");
  chips.innerHTML = `<button type="button" class="chip active" data-day="">All days</button>` +
    days.map((d, i) => `<button type="button" class="chip" data-day="${i}"><span class="dot" style="background:${dayColor(i, days.length)}"></span>Day ${i + 1}</button>`).join("");
  chips.addEventListener("click", (e) => {
    const b = e.target.closest("[data-day]");
    if (!b) return;
    chips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === b));
    drawStops(b.dataset.day === "" ? null : Number(b.dataset.day));
  });
  drawStops(null);
}

function renameTrip(j) {
  const h1 = $("#trip-title");
  const input = document.createElement("input");
  input.className = "inline-edit title-edit";
  input.value = j.title;
  input.setAttribute("aria-label", "Trip name");
  h1.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const title = input.value.trim();
    if (save && title !== j.title) {
      // Empty restores the detected name.
      await mutate("setTripEdit", j.id, { title: title && title !== j.detected_title ? title : null });
    } else {
      input.replaceWith(h1);
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

function focusStop(idx) {
  const m = markers[idx];
  if (!m || !detailMap) return;
  if (isMobile()) $("#trip-map").scrollIntoView({ behavior: "smooth", block: "center" });
  detailMap.setView(m.getLatLng(), Math.max(detailMap.getZoom(), 14));
  m.openPopup();
}
