// Places: review and label. Your labels always win over Google, the Timeline,
// OpenStreetMap and visit patterns, and they survive every re-import.

import { mutate, query } from "../../data/client.js";
import { createMap, L, pinIcon } from "../map.js";
import { namingState, onNaming } from "../naming.js";
import {
  $, esc, fmtDate, fmtInt, fmtMinutes, KINDS, kindMeta, localDate, mapsLink, plural, SOURCES, THEMES, themeIcon,
  themeLabel, toast,
} from "../util.js";

const st = { filter: "all", q: "", sort: "time", byCity: false, selected: new Set() };
let editorMap = null;
let unsubNames = null;
const TOP_N = 10;

export async function show(el, params) {
  editorMap?.remove();
  editorMap = null;
  unsubNames?.();
  if (params[0]) return showEditor(el, params[0]);
  return showList(el);
}

// ---- list ---------------------------------------------------------------------------------------
// Opens on the places that matter, most time first. One-off stops (a single short
// stop nothing reliable named) are folded away; names come from OpenStreetMap or
// Google in the background, and only your top places are worth a moment of yours.

const FILTERS = {
  all: { label: "All", test: (p) => !p.hidden },
  ...Object.fromEntries(Object.keys(KINDS).map((k) => [k, { label: `${KINDS[k].icon} ${KINDS[k].label}`, test: (p) => !p.hidden && p.kind === k }])),
  unnamed: { label: "Unnamed", test: (p) => !p.hidden && !p.named && !["home", "work"].includes(p.kind) },
  hidden: { label: "\u{1F648} Hidden", test: (p) => p.hidden },
};
const SORTS = {
  time: { label: "Most time", by: (a, b) => b.minutes - a.minutes },
  visits: { label: "Most visits", by: (a, b) => b.visits - a.visits || b.minutes - a.minutes },
  recent: { label: "Recent", by: (a, b) => (b.last_visit || "").localeCompare(a.last_visit || "") },
};

async function showList(el) {
  const [{ places }, status] = await Promise.all([query("places", { includeHidden: true }), query("status")]);
  const main = places.filter((p) => !p.oneoff);
  const counts = Object.fromEntries(Object.entries(FILTERS).map(([k, f]) => [k, main.filter(f.test).length]));
  const oneoffs = places.filter((p) => p.oneoff && !p.hidden);
  const named = main.filter((p) => p.named).length;
  if (!counts[st.filter]) st.filter = "all";

  el.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Places</h1>
      <p>${fmtInt(main.length)} places · ${fmtInt(named)} named${oneoffs.length ? ` · ${fmtInt(oneoffs.length)} one-off stops folded away` : ""}</p>
      <p class="muted small" id="names-line"></p></div></div>
    ${topCard(main, status.settings)}
    <div class="filters">
      <input class="input grow" type="search" id="places-q" placeholder="Search names, cities, states" value="${esc(st.q)}" aria-label="Search places">
      <select class="select" id="places-sort" aria-label="Sort">${Object.entries(SORTS).map(([k, x]) =>
        `<option value="${k}" ${k === st.sort ? "selected" : ""}>${x.label}</option>`).join("")}</select>
      <label class="toggle"><input type="checkbox" id="places-city" ${st.byCity ? "checked" : ""}> By city</label>
    </div>
    <div class="chips" id="places-filter" style="margin-bottom:12px">
      ${Object.entries(FILTERS).filter(([k]) => k === "all" || counts[k]).map(([k, f]) => chip(k, f.label, counts[k])).join("")}
    </div>
    <div class="bulk-bar hidden" id="bulk-bar">
      <span id="bulk-count"></span>
      <div class="row">${["explored", "everyday", "family"].map((k) =>
        `<button type="button" class="btn small outline" data-bulk-kind="${k}">${KINDS[k].icon} ${KINDS[k].label}</button>`).join("")}
        <button type="button" class="btn small outline" data-bulk-hide="1">Hide</button>
        <button type="button" class="btn small outline" data-bulk-hide="0">Unhide</button>
        <button type="button" class="btn small ghost" data-bulk-clear>Clear</button></div>
    </div>
    <section class="card place-table" id="places-list"></section>
    ${oneoffs.length ? `<details class="card oneoffs" id="oneoffs">
      <summary><strong>One-off stops</strong> <span class="muted">${fmtInt(oneoffs.length)} · single short stops such as fuel, tolls or a break on the road</span></summary>
      <div id="oneoff-list"></div></details>` : ""}
  </div>`;

  const draw = () => {
    const q = st.q.trim().toLowerCase();
    const match = (p) => [p.name, p.city, p.state, p.country, p.category, p.area].filter(Boolean).join(" ").toLowerCase().includes(q);
    // A search looks through everything, one-off stops included.
    const shown = (q ? places.filter((p) => (st.filter === "hidden" ? p.hidden : !p.hidden) && match(p)) : main.filter(FILTERS[st.filter].test))
      .sort(SORTS[st.sort].by);
    const limited = shown.slice(0, 400);
    const all = limited.length > 0 && limited.every((p) => st.selected.has(p.place_id));
    let body = "";
    if (st.byCity) {
      const groups = new Map();
      for (const p of limited) {
        const key = p.city || "Unknown area";
        groups.set(key, [...(groups.get(key) || []), p]);
      }
      body = [...groups.entries()].map(([city, rows]) => `<div class="pt-group">${esc(city)}<span class="muted"> · ${plural(rows.length, "place")}</span></div>${rows.map(rowHtml).join("")}`).join("");
    } else {
      body = limited.map(rowHtml).join("");
    }
    $("#places-list").innerHTML = shown.length
      ? `<div class="pt-head"><label class="toggle"><input type="checkbox" id="select-all" ${all ? "checked" : ""}> ${plural(shown.length, "place")}</label></div>${body}`
        + (shown.length > 400 ? `<p class="muted" style="padding:10px">Showing 400 of ${fmtInt(shown.length)}. Search to narrow down.</p>` : "")
      : '<div class="empty"><span class="big">✨</span>Nothing here.</div>';
    $("#select-all")?.addEventListener("change", (e) => {
      for (const p of limited) e.target.checked ? st.selected.add(p.place_id) : st.selected.delete(p.place_id);
      draw();
    });
    syncBulk();
  };

  $("#places-q").addEventListener("input", (e) => {
    st.q = e.target.value;
    draw();
  });
  $("#places-sort").addEventListener("change", (e) => {
    st.sort = e.target.value;
    draw();
  });
  $("#places-city").addEventListener("change", (e) => {
    st.byCity = e.target.checked;
    draw();
  });
  $("#places-filter").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    st.filter = b.dataset.filter;
    st.selected.clear();
    el.querySelectorAll("[data-filter]").forEach((x) => x.classList.toggle("active", x === b));
    draw();
  });
  const onSelect = (e) => {
    const box = e.target.closest("[data-select]");
    if (!box) return;
    box.checked ? st.selected.add(box.dataset.select) : st.selected.delete(box.dataset.select);
    syncBulk();
  };
  $("#places-list").addEventListener("change", onSelect);
  $("#oneoffs")?.addEventListener("toggle", (e) => {
    if (!e.target.open || $("#oneoff-list").childElementCount) return;
    const rows = [...oneoffs].sort(SORTS.recent.by);
    $("#oneoff-list").innerHTML = `<div class="place-table">${rows.slice(0, 300).map(rowHtml).join("")}</div>`
      + (rows.length > 300 ? `<p class="muted small" style="padding:8px">Showing the latest 300. Search to find any.</p>` : "");
    $("#oneoff-list").addEventListener("change", onSelect);
  });
  $("#bulk-bar").addEventListener("click", async (e) => {
    const ids = [...st.selected];
    const kind = e.target.closest("[data-bulk-kind]")?.dataset.bulkKind;
    const hide = e.target.closest("[data-bulk-hide]")?.dataset.bulkHide;
    if (e.target.closest("[data-bulk-clear]")) {
      st.selected.clear();
      return draw();
    }
    if (!ids.length || (!kind && hide == null)) return;
    await mutate("bulkLabel", ids, kind ? { kind } : { hidden: hide === "1" });
    toast(`Updated ${plural(ids.length, "place")}`, "ok");
    st.selected.clear();
    showList(el);
  });
  wireTopCard(el);
  draw();

  // Names arriving in the background: say so, and redraw when done.
  const line = (state) => {
    const box = $("#names-line");
    if (!box) return;
    box.textContent = state
      ? `Naming places from OpenStreetMap: ${fmtInt(state.done)} of ${fmtInt(state.total ?? 0)}…`
      : status.needsName ? `${fmtInt(status.needsName)} places still have no name. ` : "";
    if (!state && status.needsName && status.settings.autoNames !== false) box.textContent += "They're looked up automatically when you're online.";
  };
  line(namingState());
  unsubNames = onNaming((state) => {
    if (document.body.dataset.view !== "places" || location.hash.split("/").length > 2) return;
    if (state) line(state);
    else showList(el);
  });
}

/** Your most visited places that still lack a real name: a short list, then stop. */
function topCandidates(main) {
  return [...main]
    .filter((p) => !p.hidden && !["home", "work"].includes(p.kind) && (!p.named || p.approx))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, TOP_N);
}

function topCard(main, settings) {
  if (settings.topNamesDone) return "";
  const rows = topCandidates(main);
  if (!rows.length) return "";
  return `<section class="card top-names" id="top-names">
    <div class="card-head"><h2>Name your top ${rows.length}</h2><span class="sub">the places you spend the most time</span></div>
    <p class="muted small">Everything else is named automatically. Not sure what a place is? "See it in Google Maps" opens that exact place. Keep a suggestion, type a name, or skip.</p>
    <div class="top-list">${rows.map((p) => `<form class="top-row" data-place="${esc(p.place_id)}">
      <span class="ico" aria-hidden="true">${kindMeta(p.kind).icon}</span>
      <span class="top-text"><input class="input" name="name" value="${esc(p.approx ? p.name : "")}" placeholder="${esc(p.name)}" aria-label="Name for ${esc(p.name)}">
        <span class="muted small">${esc([p.city, fmtMinutes(p.minutes), plural(p.visits, "visit")].filter(Boolean).join(" · "))}
          · <a href="${esc(mapsLink(p.latitude, p.longitude, "", p.place_id))}" target="_blank" rel="noopener">see it in Google Maps ↗</a></span></span>
      <button class="btn small outline" type="submit">Save</button>
    </form>`).join("")}</div>
    <div class="row end" style="margin-top:8px"><button type="button" class="btn small ghost" id="top-done">Done, hide this</button></div>
  </section>`;
}

function wireTopCard(el) {
  el.querySelectorAll(".top-row").forEach((form) => form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = form.name.value.trim() || form.name.placeholder;
    await mutate("setLabel", form.dataset.place, { name });
    form.classList.add("saved");
    form.querySelector("button").textContent = "Saved ✓";
    form.querySelector("button").disabled = true;
  }));
  $("#top-done")?.addEventListener("click", async () => {
    await mutate("setSettings", { topNamesDone: true });
    $("#top-names")?.remove();
  });
}

function chip(key, label, n) {
  return `<button type="button" class="chip ${st.filter === key ? "active" : ""}" data-filter="${key}">${label}<span class="n">${fmtInt(n)}</span></button>`;
}

function rowHtml(p) {
  const source = p.name_source ? SOURCES[p.name_source]
    : p.kind === "home" ? "found from where you sleep"
      : p.kind === "work" ? "found from your weekdays"
        : p.area ? "neighbourhood" : "no name yet";
  return `<div class="pt-row">
    <input type="checkbox" data-select="${esc(p.place_id)}" ${st.selected.has(p.place_id) ? "checked" : ""} aria-label="Select ${esc(p.name)}">
    <a class="pt-main" href="#/places/${encodeURIComponent(p.place_id)}">
      <span class="ico" aria-hidden="true">${themeIcon(p.theme)}</span>
      <span class="pt-text"><span class="nm${p.named ? "" : " unnamed"}">${esc(p.name)}</span>
        <span class="sub">${esc([p.city, p.state].filter(Boolean).join(", "))} · ${esc(source)}${p.merged ? ` · ${plural(p.merged + 1, "ID")} merged` : ""}</span></span>
      <span class="badge soft">${kindMeta(p.kind).icon} ${esc(kindMeta(p.kind).label)}</span>
      <span class="n">${esc(fmtMinutes(p.minutes))}</span>
    </a>
  </div>`;
}

function syncBulk() {
  const bar = $("#bulk-bar");
  if (!bar) return;
  bar.classList.toggle("hidden", st.selected.size === 0);
  $("#bulk-count").textContent = `${plural(st.selected.size, "place")} selected`;
}

// ---- editor -------------------------------------------------------------------------------------

async function showEditor(el, placeId) {
  const d = await query("place", placeId);
  if (!d) {
    el.innerHTML = `<div class="page narrow"><a href="#/places">← Places</a><div class="notice err" style="margin-top:12px">Place not found.</div></div>`;
    return;
  }
  const label = d.label || {};
  const src = d.sources;
  const auto = (field) => (label[field] ? "" : "selected");

  el.innerHTML = `<div class="page narrow stack">
    <div class="crumbs"><a href="#/places">← Places</a><a href="#/map/place/${encodeURIComponent(d.place_id)}">See on map →</a></div>
    <div class="detail-head">
      <h1>${themeIcon(d.theme)} ${esc(d.name)}</h1>
      <div class="when">${esc([d.city, d.state, d.country].filter(Boolean).join(", "))} · ${plural(d.visits.length, "visit")}${d.trip_visits ? ` · ${d.trip_visits} on trips` : ""}</div>
      <div class="row">
        <span class="badge soft">${kindMeta(d.kind).icon} ${esc(kindMeta(d.kind).label)} · ${esc(SOURCES[d.kind_source] ?? "")}</span>
        ${d.name_source ? `<span class="badge soft">Name · ${esc(SOURCES[d.name_source])}</span>` : '<span class="badge draft">No name yet</span>'}
      </div>
    </div>

    <form class="card editor" id="place-form">
      <label>Name
        <input class="input" name="name" value="${esc(label.name ?? "")}" placeholder="${esc(d.named ? d.name : "Give it a name")}"></label>
      <fieldset><legend>What is this place to you?</legend>
        <div class="kind-picker">
          <label><input type="radio" name="kind" value="" ${label.kind ? "" : "checked"}><span>Automatic<small>${label.kind ? "Let Atlas decide from your visits" : `Now: ${esc(kindMeta(d.kind).label)}`}</small></span></label>
          ${Object.entries(KINDS).map(([k, m]) => `<label><input type="radio" name="kind" value="${k}" ${label.kind === k ? "checked" : ""}>
            <span>${m.icon} ${esc(m.label)}<small>${esc(m.hint)}</small></span></label>`).join("")}
        </div>
      </fieldset>
      <div class="grid-2 tight">
        <label>Kind of place
          <select class="select" name="theme"><option value="" ${auto("theme")}>Automatic${label.theme ? "" : ` (${esc(themeLabel(d.theme))})`}</option>
            ${Object.keys(THEMES).map((t) => `<option value="${t}" ${label.theme === t ? "selected" : ""}>${THEMES[t].icon} ${esc(THEMES[t].label)}</option>`).join("")}</select></label>
        <label class="toggle" style="align-self:end"><input type="checkbox" name="hidden" ${label.hidden ? "checked" : ""}> Hide from map and stats</label>
      </div>
      <div class="grid-3">
        <label>City <input class="input" name="city" value="${esc(label.city ?? "")}" placeholder="${esc(d.city ?? "")}"></label>
        <label>State <input class="input" name="state" value="${esc(label.state ?? "")}" placeholder="${esc(d.state ?? "")}"></label>
        <label>Country <input class="input" name="country" value="${esc(label.country ?? "")}" placeholder="${esc(d.country ?? "")}"></label>
      </div>
      ${d.city && !label.city ? `<p class="muted small">Wrong city for the whole area? <a href="#/settings" data-alias="${esc(d.city)}">Rename "${esc(d.city)}" everywhere</a>.</p>` : ""}
      <label>Note <textarea class="input" name="note" rows="2" placeholder="Anything to remember">${esc(label.note ?? "")}</textarea></label>
      <div class="row end">
        ${Object.keys(label).length ? '<button type="button" class="btn ghost" id="reset-label">Back to automatic</button>' : ""}
        <button class="btn primary" type="submit">Save</button>
      </div>
    </form>

    <section class="card">
      <div class="card-head"><h2>What the sources say</h2></div>
      <dl class="sources">
        <dt>Google</dt><dd>${src.google?.name ? `${esc(src.google.name)}${src.google.types?.length ? ` <span class="muted">· ${esc(src.google.types.slice(0, 3).join(", "))}</span>` : ""}` : src.google ? "No longer listed" : '<span class="muted">Not asked</span>'}</dd>
        <dt>Timeline</dt><dd>${src.timeline?.name ? esc(src.timeline.name) : '<span class="muted">No name in the export</span>'}</dd>
        <dt>OpenStreetMap</dt><dd>${src.osm?.name ? `${esc(src.osm.name)} <span class="muted">· ${src.osm.distance} m away</span>` : src.osm ? "Nothing named nearby" : '<span class="muted">Not asked</span>'}</dd>
        <dt>Visits</dt><dd>${plural(d.weeks, "week")} with visits · ${plural(d.nights, "night")} stayed · ${esc(fmtMinutes(d.minutes))} in total</dd>
      </dl>
      <div class="mini-map" id="place-map"></div>
      <a class="link-btn" target="_blank" rel="noopener" href="${esc(d.google_maps_uri || mapsLink(d.latitude, d.longitude, d.named ? d.name : "", d.place_id))}">Open in Google Maps ↗</a>
    </section>

    <section class="card">
      <div class="card-head"><h2>Visits</h2></div>
      <ul class="visit-list">${d.visits.map((v) => `<li>
        <span>${esc(fmtDate(localDate(v.start_time)))}${v.journey_id ? ` · <a href="#/trips/${v.journey_id}">${esc(v.journey_title || "trip")}</a>` : ""}</span>
        <span class="muted">${esc(fmtMinutes(v.duration_minutes))}</span></li>`).join("")}</ul>
    </section>
  </div>`;

  editorMap = createMap($("#place-map"));
  L.marker([d.latitude, d.longitude], { icon: pinIcon(themeIcon(d.theme)) }).addTo(editorMap);
  editorMap.setView([d.latitude, d.longitude], 16);

  $("#place-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const patch = {};
    for (const k of ["name", "kind", "theme", "city", "state", "country", "note"]) patch[k] = String(f.get(k) ?? "").trim() || null;
    patch.hidden = f.get("hidden") === "on";
    await mutate("setLabel", d.place_id, patch);
    toast("Saved. Applies everywhere, and survives re-imports.", "ok");
    showEditor(el, placeId);
  });
  $("#reset-label")?.addEventListener("click", async () => {
    await mutate("setLabel", d.place_id, Object.fromEntries(Object.keys(label).map((k) => [k, null])));
    toast("Back to automatic labels", "ok");
    showEditor(el, placeId);
  });
  el.querySelector("[data-alias]")?.addEventListener("click", (e) => {
    e.preventDefault();
    location.hash = "#/settings";
    setTimeout(() => {
      const form = document.querySelector("#alias-form");
      if (!form) return;
      form.from.value = e.target.dataset.alias;
      form.to.focus();
      form.scrollIntoView({ block: "center" });
    }, 300);
  });
}

