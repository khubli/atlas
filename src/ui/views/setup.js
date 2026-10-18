// After the first import: confirm what Atlas inferred, and name the places,
// so every screen after it is built on the right facts.
//   1. Homes over time, work, family homes
//   2. Names for your places (OpenStreetMap, free)
//   3. What counts as a trip

import { mutate, query, rpc } from "../../data/client.js";
import { createMap, fit, L, pinIcon } from "../map.js";
import { namingState, onNaming, startOsm, stopOsm } from "../naming.js";
import { $, esc, fmtDate, fmtInt, kindMeta, plural, toast } from "../util.js";
import { lensControls, wireLens } from "./settings.js";

let map = null;
let unsubscribe = null;
const FAMILY_SHOWN = 3;

export async function show(el) {
  unsubscribe?.();
  const [status, homes, places, overview, pending] = await Promise.all([
    query("status"), query("homes"), query("places", { kinds: ["home", "work", "family"] }), query("overview"), rpc("pending"),
  ]);
  const work = places.places.filter((p) => p.kind === "work").sort((a, b) => b.visits - a.visits);
  const family = places.places.filter((p) => p.kind === "family").sort((a, b) => b.nights - a.nights);

  el.innerHTML = `<div class="page narrow stack">
    <div class="page-head"><div><h1>Check what Atlas found</h1>
      <p>Three quick steps. Skipping is fine: everything here can be changed later on Places and Settings.</p></div></div>

    <section class="card">
      <div class="card-head"><h2>1 · Where you've lived and worked</h2><span class="sub">from where you sleep and spend weekdays</span></div>
      <div class="setup-map" id="setup-map"></div>
      <h3 class="setup-sub">${kindMeta("home").icon} Home${homes.length > 1 ? "s over time" : ""}</h3>
      <div class="setup-list">
        ${homes.some((h) => h.guessed) ? `<p class="notice">Atlas couldn't tell where you live from the nights in this export.
          Open <a href="#/places">Places</a>, find your home and mark it as Home; trips and commutes are measured from it.</p>`
        : homes.length ? homes.map((h) => row({
          id: h.place_id,
          title: [h.city, h.country].filter(Boolean).join(", ") || h.name,
          sub: `${fmtDate(h.from)} – ${fmtDate(h.to)} · ${plural(h.nights, "night")}${h.named ? ` · ${h.name}` : ""}`,
          action: ["explored", "Not a home"],
        })).join("") : '<p class="notice">No home found yet. Mark yours as Home on <a href="#/places">Places</a>.</p>'}
      </div>
      <h3 class="setup-sub">${kindMeta("work").icon} Work</h3>
      <div class="setup-list">
        ${work.length ? work.slice(0, 4).map((w) => row({
          id: w.place_id,
          title: w.named ? w.name : `Work in ${w.city ?? "an unknown area"}`,
          sub: `${[w.city, w.state].filter(Boolean).join(", ")} · ${plural(w.visits, "visit")}`,
          action: ["explored", "Not work"],
        })).join("") : '<p class="muted small">No workplace found. If you commute, mark the place as Work on Places to see commutes on Everyday.</p>'}
      </div>
      ${family.length ? `<h3 class="setup-sub">${kindMeta("family").icon} Places you often stay the night</h3>
        <p class="muted small">Ticked places count as family homes. In trip rules you can choose whether visits there count as trips.</p>
        <div class="setup-list">${family.slice(0, FAMILY_SHOWN).map((f) => `<label class="setup-row toggle-row">
          <span class="ico" aria-hidden="true">${kindMeta("family").icon}</span>
          <span><strong>${esc(f.named ? f.name : `Place in ${f.city ?? "an unknown area"}`)}</strong>
            <span class="muted small">${plural(f.nights, "night")} · ${esc([f.city, f.state].filter(Boolean).join(", "))}</span></span>
          <input type="checkbox" data-family="${esc(f.place_id)}" checked aria-label="Family home">
        </label>`).join("")}</div>
        ${family.length > FAMILY_SHOWN ? `<p class="muted small"><a href="#/places">${plural(family.length - FAMILY_SHOWN, "more place")}</a> marked the same way.</p>` : ""}` : ""}
    </section>

    <section class="card" id="names-card">
      <div class="card-head"><h2>2 · Names for your places</h2>
        <span class="sub">${fmtInt(status.named)} named</span></div>
      <div id="names-body"></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>3 · What counts as a trip</h2><span class="sub" id="lens-count">${plural(overview.totals.journeys, "trip")} right now</span></div>
      ${lensControls(status.settings.lens)}
    </section>

    <div class="row end"><button type="button" class="btn primary" id="setup-done">Done: show my travels</button></div>
  </div>`;

  drawMap(homes, work, family.slice(0, FAMILY_SHOWN));
  const renderNames = () => names($("#names-body"), pending.osm, namingState());
  renderNames();
  unsubscribe = onNaming(() => (document.body.dataset.view === "setup" ? renderNames() : unsubscribe?.()));

  el.querySelectorAll("[data-kind-set]").forEach((b) => b.addEventListener("click", async () => {
    await mutate("setLabel", b.dataset.place, { kind: b.dataset.kindSet });
    toast(b.dataset.done, "ok");
    show(el);
  }));
  el.querySelectorAll("[data-family]").forEach((box) => box.addEventListener("change", async () => {
    await mutate("setLabel", box.dataset.family, { kind: box.checked ? "family" : "explored" });
    toast(box.checked ? "Marked as a family home" : "No longer a family home", "ok");
  }));
  wireLens(el, async () => {
    const o = await query("overview");
    $("#lens-count").textContent = `${plural(o.totals.journeys, "trip")} right now`;
  });
  $("#setup-done").addEventListener("click", async () => {
    await mutate("setSettings", { setupDone: true });
    location.hash = "#/";
  });
}

function row({ id, title, sub, action: [kind, label] }) {
  return `<div class="setup-row">
    <span class="ico" aria-hidden="true">✓</span>
    <span><strong>${esc(title)}</strong><span class="muted small">${esc(sub)}</span></span>
    <button type="button" class="btn small ghost" data-kind-set="${kind}" data-place="${esc(id)}" data-done="${esc(`Marked "${title}" as ${label.toLowerCase()}`)}">${esc(label)}</button>
  </div>`;
}

const SAVED_TIP = `<p class="muted small" style="margin-top:8px">For exact names of the places you care about, import the places you
  starred or labelled in Google Maps: <a href="#/import?guide=saved">how to get them</a>. They're your own data, and free.</p>`;

function names(box, pendingCount, running) {
  if (!box) return;
  if (running) {
    const pct = running.total ? Math.round((running.done / running.total) * 100) : 0;
    box.innerHTML = `<div class="progress-label">Naming places from OpenStreetMap: ${fmtInt(running.done)} of ${fmtInt(running.total ?? pendingCount)} · ${fmtInt(running.found)} named or labelled
        <button type="button" class="btn small ghost" id="names-stop">Stop</button></div>
      <div class="progress"><span style="width:${pct}%"></span></div>
      <p class="muted small">This started on its own and keeps going while you look around.</p>${SAVED_TIP}`;
    $("#names-stop").addEventListener("click", () => stopOsm());
    return;
  }
  if (!pendingCount) {
    box.innerHTML = `<p class="muted">Every place has a name or a neighbourhood label. You can rename any place where you see it.</p>${SAVED_TIP}`;
    return;
  }
  box.innerHTML = `<p>Google's export has no place names. Atlas names what's right at each spot from OpenStreetMap, and labels
      the rest by neighbourhood or a nearby landmark.</p>
    <div class="row" style="margin-top:10px">
      <button type="button" class="btn primary" id="names-osm">Name ${plural(pendingCount, "place")} now</button>
      <a class="btn ghost" href="#/import?guide=saved">Import saved places</a>
    </div>
    <p class="muted small" style="margin-top:8px">Free. Only place coordinates are sent, to OpenStreetMap's Overpass service.</p>`;
  $("#names-osm").addEventListener("click", () => startOsm(pendingCount));
}

function drawMap(homes, work, family) {
  map?.remove();
  map = createMap($("#setup-map"));
  const pts = [];
  const add = (lat, lng, icon, label) => {
    if (lat == null) return;
    L.marker([lat, lng], { icon: pinIcon(icon) }).bindPopup(esc(label)).addTo(map);
    pts.push([lat, lng]);
  };
  homes.forEach((h) => add(h.latitude, h.longitude, kindMeta("home").icon, `Home · ${h.city ?? ""}`));
  work.forEach((w) => add(w.latitude, w.longitude, kindMeta("work").icon, w.name));
  family.forEach((f) => add(f.latitude, f.longitude, kindMeta("family").icon, f.name));
  // Frame where you live now; earlier homes abroad would zoom out to half the world.
  const now = homes[homes.length - 1];
  const near = now?.latitude != null
    ? pts.filter(([lat, lng]) => Math.hypot(lat - now.latitude, (lng - now.longitude) * Math.cos((lat * Math.PI) / 180)) * 111 < 400)
    : pts;
  fit(map, near.length ? near : pts, 12);
}
