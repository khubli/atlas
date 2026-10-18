// First run and importing: how to get the export off your phone, and reading it.

import { call, changed, query } from "../../data/client.js";
import { autoName } from "../naming.js";
import { canInstall, isAndroid, isIOS, isStandalone, onInstallable, promptInstall } from "../pwa.js";
import { $, esc, fmtDate, fmtInt, plural, toast } from "../util.js";

const GUIDES = {
  android: {
    label: "Android",
    steps: [
      "Open the phone's own <b>Settings</b> app (not Google Maps), then <b>Location</b> → <b>Location services</b> → <b>Timeline</b>. Can't find it? Search Settings for <b>Timeline</b>.",
      "Tap <b>Export Timeline data</b>, confirm it's you, and save the file. It usually lands in <b>Downloads</b> as <code>Timeline.json</code> (the name can differ by language).",
      "Come back here and choose that file. Once Atlas is installed you can also share it straight from the Files app: <b>Share → Atlas</b>.",
    ],
  },
  ios: {
    label: "iPhone",
    steps: [
      "Open <b>Google Maps</b>, tap your profile picture, then <b>Settings</b> → <b>Personal content</b>.",
      "Tap <b>Export Timeline data</b> and choose <b>Save to Files</b>. The file is usually called <code>location-history.json</code>.",
      "Come back here and choose the file from <b>Files</b>.",
    ],
  },
  saved: {
    label: "Saved places",
    steps: [
      "Optional, for better names: the places you starred or labelled in Google Maps are your own data, so Atlas can use their exact names.",
      "Open <a href=\"https://takeout.google.com/\" target=\"_blank\" rel=\"noopener\">Google Takeout</a>, tap <b>Deselect all</b>, then tick <b>Maps (your places)</b> and <b>Maps</b>. Export once and download the zip.",
      "Choose the zip here (or just <code>Saved Places.json</code> and <code>Labeled places.json</code> from it). Every visited place at the same spot takes that name.",
    ],
  },
  takeout: {
    label: "Old Takeout",
    steps: [
      "Timeline now lives on your phone, so new history comes from the phone export. If you saved a <b>Google Takeout</b> of Location History in earlier years, it can fill in older trips.",
      "Choose the Takeout <code>.zip</code>, or select all the monthly files from its <b>Semantic Location History</b> folder at once.",
      "Importing both is fine: Atlas skips anything it already has.",
    ],
  },
};

const STAGES = { reading: "Reading your export", merging: "Merging with what you have", saving: "Saving on this device", analysing: "Finding trips and places" };

let busy = false;

export async function show(el, params, { view, search, status }) {
  const importing = view === "import";
  const platform = GUIDES[search?.get("guide")] ? search.get("guide") : isIOS() ? "ios" : "android";
  el.innerHTML = `<div class="page narrow stack">
    ${importing && !status?.empty ? "" : hero()}
    <section class="card" id="import-card">
      <div class="card-head"><h2>${status?.empty ? "Import your Timeline" : "Import another export"}</h2>
        <span class="sub">${status?.empty ? "about 2 minutes" : "only new history is added"}</span></div>
      <div class="seg seg-fill" role="tablist">${Object.entries(GUIDES).map(([k, g]) =>
        `<button type="button" data-guide="${k}" class="${k === platform ? "active" : ""}">${g.label}</button>`).join("")}</div>
      <ol class="steps" id="guide-steps"></ol>
      <label class="dropzone" id="dropzone">
        <input type="file" id="file-input" accept=".json,.zip,application/json,application/zip" multiple>
        <span class="dz-icon" aria-hidden="true">\u{1F4C2}</span>
        <span><strong>Choose your Timeline file</strong><br><span class="muted">or drop it here · .json or .zip</span></span>
      </label>
      <div id="import-progress" class="hidden"></div>
      <p class="privacy-note">\u{1F512} Your file is read on this device and never uploaded. To name your places, Atlas then sends
        only their coordinates to OpenStreetMap; you can turn that off in Settings.</p>
    </section>
    ${status?.empty ? `<section class="card demo-card">
      <div><h2>Just looking?</h2><p class="muted">Explore Atlas with a made-up traveller's 7 years of trips.</p></div>
      <button type="button" class="btn outline" id="btn-demo">Try with demo data</button>
    </section>` : ""}
    <section class="card hidden" id="install-card"></section>
  </div>`;

  const showGuide = (k) => {
    $("#guide-steps").innerHTML = GUIDES[k].steps.map((s) => `<li>${s}</li>`).join("");
    el.querySelectorAll("[data-guide]").forEach((b) => b.classList.toggle("active", b.dataset.guide === k));
  };
  showGuide(platform);
  el.querySelectorAll("[data-guide]").forEach((b) => b.addEventListener("click", () => showGuide(b.dataset.guide)));

  const input = $("#file-input");
  input.addEventListener("change", () => input.files.length && runImport([...input.files], status));
  const dz = $("#dropzone");
  dz.addEventListener("dragover", (e) => {
    e.preventDefault();
    dz.classList.add("over");
  });
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("over");
    if (e.dataTransfer.files.length) runImport([...e.dataTransfer.files], status);
  });
  $("#btn-demo")?.addEventListener("click", () => runDemo());
  renderInstall();

  // Files handed over by the OS: Android share sheet (via the service worker) or "Open with" on desktop.
  if (search?.has("shared")) {
    const files = await sharedFiles();
    if (files.length) runImport(files, status);
    else toast("The shared file didn't arrive. Choose it here instead.", "err");
  } else if (search?.has("launch") && window.__atlasLaunchFiles?.length) {
    const files = window.__atlasLaunchFiles;
    window.__atlasLaunchFiles = null;
    runImport(files, status);
  }
}

function hero() {
  return `<section class="welcome-hero">
    <img src="./icons/atlas.svg" alt="" width="72" height="72">
    <h1>Your travels, rebuilt from your own Google Timeline</h1>
    <ul class="ticks">
      <li>Every trip you've taken, found automatically, with maps, days and distances</li>
      <li>Places you've explored, labelled the way you'd label them</li>
      <li>Everything stays on this device. No account, nothing uploaded</li>
    </ul>
  </section>`;
}

function renderInstall() {
  const card = $("#install-card");
  if (!card || isStandalone()) return;
  const draw = (installable) => {
    if (installable) {
      card.innerHTML = `<div class="row" style="justify-content:space-between"><div><h2>Install Atlas</h2>
        <p class="muted">Opens like an app and works offline.</p></div>
        <button type="button" class="btn primary" id="btn-install-now">Install</button></div>`;
      $("#btn-install-now").addEventListener("click", () => promptInstall());
      card.classList.remove("hidden");
    } else if (isIOS()) {
      card.innerHTML = `<h2>Install Atlas</h2><p class="muted">In Safari, tap <b>Share</b> → <b>Add to Home Screen</b>. Atlas then opens like an app and works offline.</p>`;
      card.classList.remove("hidden");
    } else {
      card.classList.add("hidden");
    }
  };
  draw(canInstall());
  onInstallable(draw);
}

async function sharedFiles() {
  try {
    const cache = await caches.open("atlas-share");
    const keys = await cache.keys();
    const files = [];
    for (const req of keys) {
      const res = await cache.match(req);
      const name = decodeURIComponent(res.headers.get("X-File-Name") || "shared.json");
      files.push(new File([await res.blob()], name));
      await cache.delete(req);
    }
    return files;
  } catch {
    return [];
  }
}

function progressView(p) {
  const box = $("#import-progress");
  if (!box) return;
  box.classList.remove("hidden");
  const fraction = p.stage === "reading" ? p.fraction ?? 0 : p.stage === "merging" ? 1 : 1;
  const label = STAGES[p.stage] ?? "Working";
  const file = p.file && p.count > 1 ? ` (${p.index + 1} of ${p.count})` : "";
  box.innerHTML = `<div class="progress-label">${esc(label)}${esc(file)}…</div>
    <div class="progress"><span style="width:${Math.round(fraction * 100)}%"></span></div>`;
}

async function runImport(files, status) {
  if (busy) return;
  busy = true;
  $("#dropzone")?.classList.add("busy");
  try {
    const { promise } = call("importFiles", [files], progressView);
    const result = await promise;
    changed({ method: "importFiles" });
    showResult(result, status);
    autoName();
  } catch (e) {
    const box = $("#import-progress");
    if (box) box.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
  } finally {
    busy = false;
    $("#dropzone")?.classList.remove("busy");
  }
}

async function runDemo() {
  if (busy) return;
  busy = true;
  try {
    const base = document.baseURI;
    const { promise } = call("importDemo", [new URL("demo/timeline.json", base).href, new URL("demo/places.json", base).href], progressView);
    const result = await promise;
    changed({ method: "importDemo" });
    showResult(result, { empty: true });
  } catch (e) {
    toast(e.message, "err");
  } finally {
    busy = false;
  }
}

const FORMAT_LABELS = { android: "Android export", ios: "iPhone export", takeout: "Google Takeout", saved: "Google Maps saved places" };

function showResult({ records, status }, before) {
  const box = $("#import-progress");
  const added = records.reduce((s, r) => s + r.added.visits, 0);
  const read = records.reduce((s, r) => s + r.read.visits, 0);
  const saved = records.reduce((s, r) => s + (r.read.saved || 0), 0);
  const savedOnly = records.every((r) => r.format === "saved");
  const formats = [...new Set(records.map((r) => FORMAT_LABELS[r.format] ?? r.format))].join(", ");
  const next = status.settings.setupDone ? "#/" : "#/setup";
  box.classList.remove("hidden");
  box.innerHTML = `<div class="import-result">
    <div class="big-tick" aria-hidden="true">✅</div>
    <div>
      <strong>${savedOnly ? `${fmtInt(saved)} saved places read` : added ? `${fmtInt(added)} new visits added` : "Nothing new: you already had all of this"}</strong>
      <div class="muted">${esc(formats)}${savedOnly ? " · their names now apply to the places you visited there" : ` · ${fmtInt(read)} visits read`}${!savedOnly && saved ? ` · ${fmtInt(saved)} saved places` : ""}${status.first && !savedOnly ? ` · history ${esc(fmtDate(status.first))} – ${esc(fmtDate(status.last))}` : ""}</div>
      <div class="muted">${plural(status.places, "place")} in total</div>
    </div>
    <a class="btn primary" href="${next}">${before?.empty || !status.settings.setupDone ? "Continue" : "See your travels"}</a>
  </div>`;
  query("status").catch(() => {});
}
