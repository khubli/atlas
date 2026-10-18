import { dataVersion, query } from "../../data/client.js";
import { calendarYear, chartWithTable, columnChart, hbars, tableView } from "../charts.js";
import {
  $, addDays, bindTips, esc, fmtDate, fmtInt, fmtKm, fmtMinutes, fmtMonthYear, fmtRange, mainMode, modeMeta,
  plural, themeIcon, themeLabel, todayIso,
} from "../util.js";

const METRICS = {
  days_away: { label: "Days away", unit: "days" },
  journeys: { label: "Trips", unit: "trips" },
  distance_km: { label: "Distance", unit: "km" },
  new_places: { label: "New places", unit: "places" },
};

const SIGHTS = new Set(["landmark", "nature", "worship", "culture", "fun"]);

let state = null;

export async function show(el) {
  if (state?.el === el && state.version === dataVersion()) return; // nothing changed since the last render
  if (!state) el.innerHTML = '<div class="page"><div class="spinner">Loading your travels</div></div>';
  let data;
  try {
    data = await query("overview");
  } catch (e) {
    el.innerHTML = `<div class="page"><div class="notice err">${esc(e.message)}</div></div>`;
    return;
  }
  state = {
    el, data, version: dataVersion(),
    metric: state?.metric ?? (data.has_journeys ? "days_away" : "new_places"), year: state?.year ?? null,
  };
  render();
  loadMemories();
}

function lensLine(lens) {
  const base = ["home", lens.workIsBase && "work", lens.familyIsBase && "family homes"].filter(Boolean).join(", ");
  return `Trips: ${lens.minHours}+ hours spent ${lens.awayKm} km or more from ${base.replace(/, ([^,]*)$/, " or $1")}.`;
}

function render() {
  const { el, data } = state;
  const t = data.totals;
  const since = t.first_date ? fmtMonthYear(t.first_date) : null;

  el.innerHTML = `<div class="page stack">
    <div class="page-head">
      <div>
        <h1>Your travels</h1>
        <p>${since ? `Since ${esc(since)} · ` : ""}from your Google Timeline, on this device</p>
      </div>
      <a class="lens-chip" href="#/settings" title="Change what counts as a trip">${esc(lensLine(data.lens))} <span>Change</span></a>
    </div>
    ${data.has_journeys ? "" : `<div class="notice">No trips match your trip rules yet. Try a shorter distance in
      <a href="#/settings">Settings</a>; everyday life is on the <a href="#/everyday">Everyday</a> page.</div>`}
    ${hero(t)}
    ${kpis(t)}
    <div id="memories"></div>
    <div class="grid-2">
      <section class="card" id="year-card">
        <div class="card-head">
          <h2>Travel by year</h2>
          <button type="button" class="link-btn" data-table-toggle>Table</button>
        </div>
        <div class="seg seg-fill" role="tablist" style="margin-bottom:12px">${Object.entries(METRICS).map(([k, m]) =>
          `<button type="button" data-metric="${k}" class="${k === state.metric ? "active" : ""}">${m.label}</button>`).join("")}</div>
        <div class="chart" data-chart></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>What you explore</h2><span class="sub">explored places by kind · tap to map</span></div>
        ${exploreBars(data)}
      </section>
    </div>
    <section class="card" id="cal-card">
      <div class="card-head">
        <h2>Travel calendar</h2>
        <div class="cal-legend"><span><i style="background:var(--cal-day)"></i>Day trip</span><span><i style="background:var(--cal-night)"></i>Overnight</span></div>
      </div>
      <div class="chips" id="cal-years"></div>
      <div id="cal-body"></div>
    </section>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>Top destinations</h2><span class="sub">by number of trips</span></div>
        ${destinations(data.destinations)}
      </section>
      <div class="stack">
        <section class="card" id="states-card">
          <div class="card-head"><h2>States &amp; regions</h2><span class="sub">places explored</span></div>
          <div id="states-body"></div>
        </section>
        <section class="card">
          <div class="card-head"><h2>How you travel</h2><span class="sub">distance on trips</span></div>
          ${transport(data.transport)}
        </section>
      </div>
    </div>
    <section class="card">
      <div class="card-head"><h2>Recent trips</h2><a class="link-btn" href="#/trips">All trips →</a></div>
      ${recent(data.journeys)}
    </section>
  </div>`;

  bindTips(el);
  el.onclick = onClick;
  wireYearChart();
  renderStates(false);
  renderCalendarYears();
}

function hero(t) {
  if (!Number(t.journeys)) {
    return `<section class="hero"><span class="eyebrow">Explored</span>
      <div class="figure">${fmtInt(t.places)}<small>places</small></div>
      <div class="line">${plural(t.cities, "city", "cities")} · ${plural(t.states, "state")} · ${plural(t.visits, "visit")}</div></section>`;
  }
  return `<section class="hero">
    <span class="eyebrow">On the road</span>
    <div class="figure">${fmtInt(t.days_away)}<small>days away from home</small></div>
    <div class="line">${plural(t.journeys, "trip")} · ${plural(t.nights, "night")} · ${fmtKm(t.distance_km)} travelled</div>
  </section>`;
}

// Places with no name or type all land in "Other"; showing them as one huge bar
// hides everything else, so they become a note with the fix instead.
function exploreBars(data) {
  const known = data.themes.filter((r) => r.theme !== "other");
  const other = data.themes.find((r) => r.theme === "other")?.places ?? 0;
  const note = other
    ? `<p class="muted small" style="margin-top:10px">${fmtInt(other)} ${other === 1 ? "place isn't" : "places aren't"} sorted yet: they have no name or type.
       <a href="#/settings?names=osm">Look up names</a> to sort them.</p>`
    : "";
  if (!known.length) return `<p class="muted">Kinds of places appear once your places have names.</p>${note}`;
  return hbars(known.map((r) => ({
    name: themeLabel(r.theme), icon: themeIcon(r.theme), value: r.places, action: `#/map/theme/${r.theme}`,
  }))) + note;
}

function kpis(t) {
  const far = t.farthest;
  const tiles = [
    ["Trips", fmtInt(t.journeys), `${fmtInt(t.overnight)} overnight · ${fmtInt(t.day_trips)} day`],
    ["Distance", [fmtInt(t.distance_km), "km"], far ? `farthest ${fmtKm(far.max_distance_km)} from home` : ""],
    ["Places explored", fmtInt(t.places), `of ${fmtInt(t.all_places ?? t.places)} places${t.oneoff_places ? `, plus ${fmtInt(t.oneoff_places)} one-off stops` : ""}`],
    ["Cities", fmtInt(t.cities), ""],
    ["States", fmtInt(t.states), plural(t.countries, "country", "countries")],
    ["Nights away", fmtInt(t.nights), "days away also count the day you leave"],
  ];
  const show = (v) => (Array.isArray(v) ? `${esc(v[0])}<small> ${esc(v[1])}</small>` : esc(v));
  // Before trips are detected, trip tiles would only show zeros.
  const shown = Number(t.journeys) ? tiles : tiles.filter(([label]) => ["Places explored", "Cities", "States"].includes(label));
  return `<div class="kpis">${shown.map(([label, value, note]) =>
    `<div class="kpi"><div class="label">${label}</div><div class="value">${show(value)}</div>${note ? `<div class="note">${esc(note)}</div>` : ""}</div>`).join("")}</div>`;
}

function destinations(rows) {
  if (!rows.length) return '<p class="muted">Destinations appear once trips are detected.</p>';
  return `<div class="dest-list">${rows.map((d, i) => `<div class="dest">
      <span class="rank">${i + 1}</span>
      <span><span class="name">${esc(d.city)}</span><span class="sub"> · ${esc(d.state || "")}</span>
        <div class="sub">last ${esc(fmtDate(d.last_date))} · ${esc(fmtMinutes(d.minutes))} there</div></span>
      <span class="num">${plural(d.trips, "trip")}</span>
    </div>`).join("")}</div>`;
}

function transport(rows) {
  const shown = rows.filter((r) => r.km >= 1);
  if (!shown.length) return '<p class="muted">Transport modes appear once trips are detected.</p>';
  return hbars(shown.map((r) => ({
    name: modeMeta(r.mode).label, icon: modeMeta(r.mode).icon, value: r.km, display: fmtKm(r.km),
    sub: plural(r.trips, "trip"), color: modeMeta(r.mode).color,
  })));
}

function renderStates(all) {
  const rows = state.data.states;
  const shown = all ? rows : rows.slice(0, 8);
  $("#states-body").innerHTML = rows.length
    ? hbars(shown.map((s) => ({
        name: s.state, value: s.places, display: plural(s.places, "place"),
        sub: s.trips ? plural(s.trips, "trip") : "",
      }))) + (rows.length > 8 ? `<button type="button" class="link-btn" data-states-all style="margin-top:10px">${all ? "Show fewer" : `Show all ${rows.length}`}</button>` : "")
    : '<p class="muted">No states yet.</p>';
}

function recent(journeys) {
  if (!journeys.length) return '<p class="muted">No trips yet.</p>';
  return `<div class="trip-grid">${journeys.slice(0, 6).map(tripCard).join("")}</div>`;
}

/** The trip's shape: home (ringed dot) out to the farthest stop (amber) and back. */
function routeSketch(route, size = 46) {
  if (!route || route.length < 2) return null;
  const k = Math.cos((route[0][0] * Math.PI) / 180);
  const xs = route.map((p) => p[1] * k);
  const ys = route.map((p) => -p[0]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const pad = 7;
  const scale = (size - pad * 2) / span;
  const ox = pad + ((size - pad * 2) - (x1 - x0) * scale) / 2;
  const oy = pad + ((size - pad * 2) - (y1 - y0) * scale) / 2;
  const pts = route.map((_, i) => [ox + (xs[i] - x0) * scale, oy + (ys[i] - y0) * scale]);
  let far = 1;
  let best = -1;
  pts.forEach(([x, y], i) => {
    const d = (x - pts[0][0]) ** 2 + (y - pts[0][1]) ** 2;
    if (d > best) [best, far] = [d, i];
  });
  const f = (n) => n.toFixed(1);
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <polyline points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}" fill="none" stroke="var(--brand)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${f(pts[far][0])}" cy="${f(pts[far][1])}" r="3.4" fill="#f2b33d"/>
    <circle cx="${f(pts[0][0])}" cy="${f(pts[0][1])}" r="3.4" fill="var(--surface)" stroke="var(--ink-2)" stroke-width="1.8"/>
  </svg>`;
}

export function tripCard(j) {
  const mode = modeMeta(mainMode(j.transport));
  const sketch = routeSketch(j.route);
  return `<a class="trip-card" href="#/trips/${j.id}">
    <span class="trip-icon${sketch ? " sketch" : ""}" aria-hidden="true" title="${esc(mode.label)}">${sketch ?? mode.icon}</span>
    <span>
      <h3>${esc(j.title)}</h3>
      <div class="when">${esc(fmtRange(j.start_date, j.end_date))}</div>
      <div class="facts">
        <span><b>${j.nights ? plural(j.nights, "night") : "Day trip"}</b></span>
        ${j.distance_km ? `<span>${esc(fmtKm(j.distance_km))}</span>` : ""}
        ${j.place_count ? `<span>${plural(j.place_count, "place")}</span>` : ""}
        ${j.primary_state ? `<span>${esc(j.primary_state)}</span>` : ""}
      </div>
    </span>
  </a>`;
}

// ---- year chart -------------------------------------------------------------------

function wireYearChart() {
  const card = $("#year-card");
  const years = state.data.years;
  const rows = () => years.map((y) => {
    const v = Number(y[state.metric]) || 0;
    const m = METRICS[state.metric];
    return {
      label: String(y.year),
      value: v,
      tip: [`${fmtInt(v)} ${m.unit}`, `${y.year} · ${plural(y.journeys, "trip")} · ${fmtKm(y.distance_km)}`],
    };
  });
  const redraw = chartWithTable(
    card,
    (target) => (years.length ? columnChart(target, rows()) : (target.innerHTML = '<p class="muted">No data yet.</p>')),
    () => tableView(years, [
      { key: "year", label: "Year" },
      { key: "journeys", label: "Trips", num: true, format: fmtInt },
      { key: "days_away", label: "Days away", num: true, format: fmtInt },
      { key: "distance_km", label: "Km", num: true, format: fmtInt },
      { key: "new_places", label: "New places", num: true, format: fmtInt },
    ]),
  );
  card.querySelectorAll("[data-metric]").forEach((b) => b.addEventListener("click", () => {
    state.metric = b.dataset.metric;
    card.querySelectorAll("[data-metric]").forEach((x) => x.classList.toggle("active", x === b));
    redraw();
  }));
  redrawYearChart = redraw;
}

// One resize listener for the module, redrawing whichever chart is current.
let redrawYearChart = null;
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state?.el.classList.contains("active") && redrawYearChart?.(), 150);
});

// ---- calendar -----------------------------------------------------------------------

function travelDays() {
  const days = new Map();
  for (const j of state.data.journeys) {
    for (let d = j.start_date; d <= j.end_date; d = addDays(d, 1)) {
      days.set(d, { kind: j.nights ? "n" : "d", title: j.title, id: j.id });
    }
  }
  return days;
}

function renderCalendarYears() {
  const years = [...new Set(state.data.journeys.map((j) => j.start_date.slice(0, 4)))].sort().reverse();
  const current = todayIso().slice(0, 4);
  if (!years.includes(current)) years.unshift(current);
  state.year = state.year || (state.data.journeys[0]?.start_date.slice(0, 4) ?? current);
  const counts = new Map();
  for (const j of state.data.journeys) counts.set(j.start_date.slice(0, 4), (counts.get(j.start_date.slice(0, 4)) || 0) + 1);
  $("#cal-years").innerHTML = years.map((y) =>
    `<button type="button" class="chip ${y === state.year ? "active" : ""}" data-year="${y}">${y}<span class="n">${counts.get(y) || 0}</span></button>`).join("");
  $("#cal-body").innerHTML = calendarYear(Number(state.year), travelDays());
}

// ---- memories -------------------------------------------------------------------------

async function loadMemories() {
  const today = todayIso();
  let mem;
  try {
    mem = await query("memories", today);
  } catch {
    return;
  }
  const items = [];
  for (const j of mem.journeys.slice(0, 3)) {
    const yearsAgo = Number(today.slice(0, 4)) - Number(j.start_date.slice(0, 4));
    items.push(`<a class="trip-card" href="#/trips/${j.id}"><span class="trip-icon">\u{1F4C5}</span><span>
      <h3>${esc(j.title)}</h3><div class="when">${plural(yearsAgo, "year")} ago · ${esc(fmtRange(j.start_date, j.end_date))}</div></span></a>`);
  }
  // Trips, plus sights near home; a weekly cafe is not a memory.
  const seen = new Set(mem.journeys.map((j) => j.id));
  const places = new Set();
  const memorable = mem.visits.filter((x) => {
    if (x.journey_id && seen.has(x.journey_id)) return false;
    if (!x.journey_id && !SIGHTS.has(x.theme)) return false;
    if (places.has(x.place_id)) return false;
    places.add(x.place_id);
    return true;
  });
  for (const v of memorable.slice(0, 3)) {
    const yearsAgo = Number(today.slice(0, 4)) - Number(v.start_time.slice(0, 4));
    items.push(`<a class="trip-card" href="#/map/place/${encodeURIComponent(v.place_id)}"><span class="trip-icon">${themeIcon(v.theme)}</span><span>
      <h3>${esc(v.name)}</h3><div class="when">${plural(yearsAgo, "year")} ago · ${esc([v.city, v.state].filter(Boolean).join(", "))}</div></span></a>`);
  }
  const box = $("#memories");
  if (box && items.length) box.innerHTML = `<section class="card"><div class="card-head"><h2>On this day</h2><span class="sub">${esc(fmtDate(today))}</span></div><div class="trip-grid">${items.join("")}</div></section>`;
}

function onClick(e) {
  const year = e.target.closest("[data-year]");
  if (year) {
    state.year = year.dataset.year;
    renderCalendarYears();
    return;
  }
  const cell = e.target.closest("[data-journey]");
  if (cell) {
    location.hash = `#/trips/${cell.dataset.journey}`;
    return;
  }
  const action = e.target.closest("[data-action]");
  if (action) {
    location.hash = action.dataset.action;
    return;
  }
  if (e.target.closest("[data-states-all]")) {
    const all = e.target.closest("[data-states-all]").textContent.startsWith("Show all");
    renderStates(all);
  }
}
