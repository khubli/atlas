// Settings: trip rules, naming services, city names, your data, install, privacy.

import { changed, mutate, query, rpc } from "../../data/client.js";
import { enrichWithGoogle } from "../google.js";
import { namingState, onNaming, startOsm, stopOsm } from "../naming.js";
import { canInstall, isIOS, isStandalone, promptInstall } from "../pwa.js";
import { $, esc, fmtDate, fmtInt, plural, toast } from "../util.js";

const DISTANCES = [10, 25, 50, 100, 200, 500];
const FORMAT_LABELS = { android: "Android export", ios: "iPhone export", takeout: "Google Takeout", saved: "Google Maps saved places" };
const GOOGLE_FREE_CALLS = 5000;

// ---- trip rules (shared with the setup screen) ----------------------------------------------

export function lensControls(lens) {
  return `<div class="lens">
    <label class="lens-row"><span>A trip is time at least</span>
      <select class="select" data-lens="awayKm">${DISTANCES.map((d) =>
        `<option value="${d}" ${d === lens.awayKm ? "selected" : ""}>${d} km</option>`).join("")}</select>
      <span>from home</span></label>
    <label class="toggle"><input type="checkbox" data-lens="workIsBase" ${lens.workIsBase ? "checked" : ""}>
      <span>Work counts as home base <span class="muted small">(a long commute isn't a trip)</span></span></label>
    <label class="toggle"><input type="checkbox" data-lens="familyIsBase" ${lens.familyIsBase ? "checked" : ""}>
      <span>Family homes count as home base <span class="muted small">(visiting parents isn't a trip)</span></span></label>
    <label class="lens-row"><span>Shortest trip</span>
      <select class="select" data-lens="minHours">${[1, 3, 6, 12].map((h) =>
        `<option value="${h}" ${h === lens.minHours ? "selected" : ""}>${h} hours</option>`).join("")}</select></label>
    <label class="toggle"><input type="checkbox" data-lens="mergeGapHours" ${lens.mergeGapHours > 0 ? "checked" : ""}>
      <span>Join trips split by a layover at the home airport</span></label>
  </div>`;
}

export function wireLens(root, after) {
  root.querySelectorAll("[data-lens]").forEach((input) => input.addEventListener("change", async () => {
    const key = input.dataset.lens;
    let value;
    if (key === "mergeGapHours") value = input.checked ? 12 : 0;
    else if (input.type === "checkbox") value = input.checked;
    else value = Number(input.value);
    await mutate("setSettings", { lens: { [key]: value } });
    const o = await query("overview");
    toast(`${plural(o.totals.journeys, "trip")} with these rules`, "ok");
    after?.(o);
  }));
}

// ---- page -------------------------------------------------------------------------------

let job = null; // running Google naming job
let unsubNames = null;

export async function show(el, params, { search }) {
  const status = await query("status");
  const s = status.settings;
  const pending = await rpc("pending");
  const usage = s.googleUsage?.month === new Date().toISOString().slice(0, 7) ? s.googleUsage.calls : 0;
  const aliases = Object.entries(s.cityAliases || {});

  el.innerHTML = `<div class="page narrow stack">
    <div class="page-head"><div><h1>Settings</h1><p>Everything here is stored on this device only.</p></div></div>

    <section class="card" id="sec-trips">
      <div class="card-head"><h2>What counts as a trip</h2></div>
      ${lensControls(s.lens)}
      <p class="muted small" style="margin-top:10px">Home and work come from Google's labels; correct them on the
        <a href="#/setup">setup</a> page or by marking places on <a href="#/places">Places</a>.</p>
    </section>

    <section class="card" id="sec-names">
      <div class="card-head"><h2>Names for your places</h2>
        <span class="sub">${fmtInt(status.named)} named · ${fmtInt(status.needsName)} without a name</span></div>
      <div class="name-source">
        <div><strong>Your saved places</strong> <span class="badge soft">best · free</span>
          <p class="muted small">The places you starred or labelled in Google Maps carry their exact names, and they're
          your own data. Export them once from Google Takeout ("Maps (your places)" and "Maps") and import the zip.</p></div>
        <a class="btn outline" href="#/import?guide=saved">Import saved places</a>
      </div>
      <div class="name-source">
        <div><strong>OpenStreetMap</strong> <span class="badge soft">free</span>
          <p class="muted small">Looks up the nearest named landmark, restaurant or shop for each place.
          Names only what's right at the spot; everything else gets its neighbourhood or a nearby landmark. Sends only coordinates.</p>
          <label class="toggle small"><input type="checkbox" id="auto-names" ${s.autoNames === false ? "" : "checked"}>
            <span>Look up names automatically after each import</span></label></div>
        <button type="button" class="btn outline" id="btn-osm" ${pending.osm ? "" : "disabled"}>
          ${pending.osm ? `Look up ${fmtInt(pending.osm)} places` : "Nothing to look up"}</button>
      </div>
      <div class="name-source">
        <div><strong>Google Places</strong> <span class="badge soft">optional · your key</span>
          <p class="muted small">Exact names and types for the place IDs in your export, with your own Google key.
          Note that Google's terms don't allow keeping these names or showing them on non-Google maps, as Atlas does;
          using it is your call, for your own copy.
          ${fmtInt(usage)} of ${fmtInt(GOOGLE_FREE_CALLS)} free lookups used this month.
          <a href="#" id="key-help">How to get a key</a></p>
          <div class="key-help hidden" id="key-help-box">
            <ol class="steps small">
              <li>Open <a href="https://console.cloud.google.com/google/maps-apis/start" target="_blank" rel="noopener">Google Maps Platform</a> and create a project (billing must be on; Place Details has a free monthly allowance).</li>
              <li>Enable <b>Maps JavaScript API</b> and <b>Places API (New)</b>.</li>
              <li>Create an API key and restrict it to <b>Websites</b>: <code>${esc(location.origin)}/*</code>.</li>
              <li>Paste it below. It stays on this device and is never included in backups.</li>
            </ol>
          </div>
          <div class="row">
            <input class="input" type="password" id="google-key" placeholder="${s.hasGoogleKey ? "Key saved · paste to replace" : "Paste your Google Maps API key"}" autocomplete="off">
            <button type="button" class="btn small outline" id="btn-save-key">Save</button>
            ${s.hasGoogleKey ? '<button type="button" class="btn small ghost" id="btn-forget-key">Forget</button>' : ""}
          </div>
        </div>
        <button type="button" class="btn outline" id="btn-google" ${s.hasGoogleKey && pending.google ? "" : "disabled"}>
          ${pending.google ? `Name ${fmtInt(pending.google)} places` : "All asked"}</button>
      </div>
      <div id="names-progress" class="hidden"></div>
    </section>

    <section class="card" id="sec-cities">
      <div class="card-head"><h2>City names</h2><span class="sub">cities come from an offline gazetteer</span></div>
      <p class="muted small">If a place shows a district instead of its city (say "Kanayannur" for Kochi), rename it once here and every place follows.</p>
      ${aliases.length ? `<ul class="alias-list">${aliases.map(([from, to]) => `<li><span>${esc(from)} → <strong>${esc(to)}</strong></span>
        <button type="button" class="btn small ghost" data-alias-remove="${esc(from)}">Remove</button></li>`).join("")}</ul>` : ""}
      <form class="row" id="alias-form">
        <input class="input" name="from" placeholder="Shown as" required aria-label="City name shown">
        <input class="input" name="to" placeholder="Call it" required aria-label="City name to use">
        <button class="btn small outline" type="submit">Rename</button>
      </form>
    </section>

    <section class="card" id="sec-data">
      <div class="card-head"><h2>Your data</h2>
        <span class="sub">${fmtInt(status.visits)} visits · ${fmtInt(status.places)} places${status.first ? ` · ${esc(fmtDate(status.first))} – ${esc(fmtDate(status.last))}` : ""}</span></div>
      ${status.imports.length ? `<ul class="import-log">${[...status.imports].reverse().map((r) => `<li>
        <span>${esc(new Date(r.at).toLocaleDateString())} · ${esc(r.name || "export")} <span class="muted">${esc(FORMAT_LABELS[r.format] ?? r.format ?? "")}</span></span>
        <span class="muted">${r.format === "saved" ? `${fmtInt(r.read.saved ?? 0)} places` : `+${fmtInt(r.added.visits)} visits`}</span></li>`).join("")}</ul>` : '<p class="muted">Nothing imported yet.</p>'}
      <div class="row" style="margin-top:12px">
        <a class="btn small primary" href="#/import">Import a newer export</a>
        <button type="button" class="btn small outline" id="btn-backup" ${status.empty ? "disabled" : ""}>Back up</button>
        <label class="btn small outline file-btn">Restore<input type="file" id="restore-input" accept=".atlas,.json,.gz,application/gzip,application/json"></label>
        <button type="button" class="btn small danger" id="btn-delete">Delete everything</button>
      </div>
      <p class="muted small" style="margin-top:8px">A backup is one <code>.atlas</code> file with your history, labels and settings
        (not your Google key). Restore it on another phone or laptop to carry Atlas over.</p>
    </section>

    <section class="card" id="sec-device">
      <div class="card-head"><h2>This device</h2></div>
      <div id="storage-info" class="muted small">Checking storage…</div>
      <div class="row" style="margin-top:10px" id="device-actions"></div>
    </section>

    <section class="card" id="sec-privacy">
      <div class="card-head"><h2>Privacy</h2></div>
      <ul class="ticks small">
        <li>Your Timeline file is read in this browser and stored in it. Atlas has no server and no account.</li>
        <li>Map backgrounds load from OpenStreetMap's tile servers, which see the map areas you view.</li>
        <li>Naming with OpenStreetMap sends place coordinates to the Overpass API, after each import unless you turn it off above.</li>
        <li>Naming with Google, if you add a key, sends place IDs to Google with your key.</li>
        <li>Clearing site data or "Delete everything" removes it all. Keep a backup if it matters.</li>
      </ul>
      <p class="muted small">City data © GeoNames (CC BY 4.0). Map data © OpenStreetMap contributors (ODbL). Maps by Leaflet.</p>
    </section>
  </div>`;

  wireLens(el);
  wireNames(el, pending, s);
  wireCities(el);
  wireData(el);
  renderDevice();

  if (job) $("#names-progress").classList.remove("hidden");
  const focus = search?.get("names");
  if (focus) {
    $("#sec-names").scrollIntoView({ block: "start" });
    if (focus === "google") $("#key-help-box").classList.remove("hidden");
  }
}

// ---- naming -----------------------------------------------------------------------------------

function progress(label, done, total) {
  const box = $("#names-progress");
  if (!box) return;
  box.classList.remove("hidden");
  const pct = total ? Math.round((done / total) * 100) : 0;
  box.innerHTML = `<div class="progress-label">${esc(label)} ${fmtInt(done)} / ${fmtInt(total)}
    <button type="button" class="btn small ghost" id="btn-stop">Stop</button></div>
    <div class="progress"><span style="width:${pct}%"></span></div>`;
  $("#btn-stop")?.addEventListener("click", () => (job ? job.stop() : stopOsm()));
}

function wireNames(el, pending, s) {
  $("#key-help").addEventListener("click", (e) => {
    e.preventDefault();
    $("#key-help-box").classList.toggle("hidden");
  });
  $("#btn-save-key").addEventListener("click", async () => {
    const key = $("#google-key").value.trim();
    if (!key) return toast("Paste a key first", "err");
    await mutate("setSettings", { googleKey: key });
    toast("Key saved. Looking up exact names from Google…", "ok");
    await show(el, [], {});
    $("#btn-google:not([disabled])")?.click();
  });
  $("#btn-forget-key")?.addEventListener("click", async () => {
    await mutate("setSettings", { googleKey: null });
    show(el, [], {});
  });

  $("#auto-names").addEventListener("change", async (e) => {
    await mutate("setSettings", { autoNames: e.target.checked });
    toast(e.target.checked ? "Names will be looked up after each import" : "Atlas won't look up names unless you ask", "ok");
  });
  $("#btn-osm").addEventListener("click", () => {
    if (!job) startOsm(pending.osm);
  });
  // The OpenStreetMap job is shared with Setup and outlives this page.
  unsubNames?.();
  const showNames = (st) => {
    if (document.body.dataset.view !== "settings") return;
    if (st) progress(`OpenStreetMap: ${fmtInt(st.found)} named so far ·`, st.done, st.total ?? pending.osm);
    else {
      // Finished: update just this section, so a key being typed isn't wiped.
      $("#names-progress")?.classList.add("hidden");
      const btn = $("#btn-osm");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Names looked up";
      }
    }
  };
  unsubNames = onNaming(showNames);
  if (namingState()) showNames(namingState());

  $("#btn-google").addEventListener("click", async () => {
    if (job) return;
    const key = await rpc("googleKey");
    const ids = (await rpc("candidates", "google")).map((c) => c.placeId);
    const controller = new AbortController();
    job = { stop: () => controller.abort() };
    progress("Google:", 0, ids.length);
    try {
      await enrichWithGoogle({
        key,
        ids,
        signal: controller.signal,
        onBatch: (results, calls) => rpc("saveGoogle", results, calls),
        onProgress: (done, total) => progress("Google:", done, total),
      });
      toast("Names from Google saved", "ok");
    } catch (e) {
      toast(e.message, "err");
    } finally {
      job = null;
      changed({ method: "saveGoogle" });
      show(el, [], {});
    }
  });
}

// ---- city names ---------------------------------------------------------------------------------

function wireCities(el) {
  $("#alias-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const from = String(f.get("from")).trim();
    const to = String(f.get("to")).trim();
    if (!from || !to) return;
    await mutate("setSettings", { cityAliases: { [from]: to } });
    toast(`"${from}" now shows as "${to}"`, "ok");
    show(el, [], {});
  });
  el.querySelectorAll("[data-alias-remove]").forEach((b) => b.addEventListener("click", async () => {
    await mutate("setSettings", { cityAliases: { [b.dataset.aliasRemove]: null } });
    show(el, [], {});
  }));
}

// ---- data ----------------------------------------------------------------------------------------

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function wireData(el) {
  $("#btn-backup").addEventListener("click", async () => {
    const blob = await rpc("exportBackup");
    download(blob, `atlas-backup-${new Date().toISOString().slice(0, 10)}.atlas`);
    toast("Backup saved", "ok");
  });
  $("#restore-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = await query("status");
    if (!status.empty && !confirm("Restoring replaces what's on this device with the backup. Continue?")) return;
    try {
      const r = await mutate("restore", file);
      toast(r.kind === "labels" ? `Added labels for ${plural(r.places, "place")}` : "Backup restored", "ok");
      location.hash = "#/";
    } catch (err) {
      toast(err.message, "err");
    }
  });
  $("#btn-delete").addEventListener("click", async () => {
    if (!confirm("Delete all your Atlas data from this device? This can't be undone.")) return;
    await mutate("clearAll");
    toast("Everything deleted from this device", "ok");
    location.hash = "#/welcome";
  });
}

async function renderDevice() {
  const info = $("#storage-info");
  const actions = $("#device-actions");
  if (!info) return;
  let text = "";
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage != null) text += `Atlas uses ${(est.usage / 1048576).toFixed(1)} MB here. `;
    const persisted = await navigator.storage?.persisted?.();
    text += persisted
      ? "The browser keeps this data even when space runs low."
      : "The browser may clear this data if the device runs low on space.";
    if (!persisted && navigator.storage?.persist) {
      actions.insertAdjacentHTML("beforeend", '<button type="button" class="btn small outline" id="btn-persist">Keep my data</button>');
      $("#btn-persist").addEventListener("click", async () => {
        const ok = await navigator.storage.persist();
        toast(ok ? "The browser will keep Atlas's data" : "The browser declined. Installing Atlas usually helps.", ok ? "ok" : "err");
        renderDevice();
      });
    }
  } catch {
    text = "Storage details aren't available in this browser.";
  }
  info.textContent = text;
  if (!isStandalone()) {
    if (canInstall()) {
      actions.insertAdjacentHTML("beforeend", '<button type="button" class="btn small primary" id="btn-install2">Install Atlas</button>');
      $("#btn-install2").addEventListener("click", () => promptInstall());
    } else if (isIOS()) {
      actions.insertAdjacentHTML("beforeend", '<span class="muted small">To install: Safari → Share → Add to Home Screen.</span>');
    }
  }
}
