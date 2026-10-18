// Boot, hash routing and app chrome.
//   #/welcome #/import       first run, importing more data
//   #/setup                  confirm home and work
//   #/                       overview          #/trips[/:id]   trips
//   #/everyday               routine           #/map[/theme/:t | /place/:id | /kind/:k]
//   #/places[/:id]           review and label  #/settings

import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "./ui/styles.css";
import { registerSW } from "virtual:pwa-register";
import { autoName } from "./ui/naming.js";
import { init, query } from "./data/client.js";
import { onInstallable, promptInstall } from "./ui/pwa.js";
import { $, $$, hideTip, toast } from "./ui/util.js";

const loaders = {
  welcome: () => import("./ui/views/welcome.js"),
  import: () => import("./ui/views/welcome.js"),
  setup: () => import("./ui/views/setup.js"),
  overview: () => import("./ui/views/overview.js"),
  trips: () => import("./ui/views/trips.js"),
  everyday: () => import("./ui/views/everyday.js"),
  map: () => import("./ui/views/explore.js"),
  places: () => import("./ui/views/places.js"),
  settings: () => import("./ui/views/settings.js"),
};
const SECTION = { import: "welcome" };
const WITHOUT_DATA = new Set(["welcome", "import", "settings"]);

function parseHash() {
  const [path, search = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const view = loaders[parts[0]] ? parts[0] : "overview";
  return { view, params: loaders[parts[0]] ? parts.slice(1) : [], search: new URLSearchParams(search) };
}

let routeSeq = 0;
let lastPath = null;
async function route() {
  const seq = ++routeSeq;
  let { view, params, search } = parseHash();
  hideTip();
  const status = await query("status").catch(() => null);
  if (seq !== routeSeq) return;
  if (status?.empty && !WITHOUT_DATA.has(view)) {
    location.replace("#/welcome");
    return;
  }
  const section = SECTION[view] || view;
  // A new screen starts at the top; re-rendering the same one keeps your place.
  const fresh = document.body.dataset.view !== section || lastPath !== location.hash.split("?")[0];
  lastPath = location.hash.split("?")[0];
  document.body.dataset.view = section;
  document.body.classList.toggle("no-data", Boolean(status?.empty));
  $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === section));
  $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === section));
  const el = $(`#view-${section}`);
  try {
    const mod = await loaders[view]();
    if (seq !== routeSeq) return;
    await mod.show(el, params, { view, search, status });
    if (fresh) {
      window.scrollTo(0, 0);
      el.scrollTop = 0;
    }
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="page"><div class="notice err">Something went wrong: ${String(e.message || e)}</div></div>`;
  }
}

// ---- theme ---------------------------------------------------------------------

function effectiveTheme() {
  return document.documentElement.dataset.theme
    || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
$("#btn-theme").addEventListener("click", () => {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("atlas-theme", next);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event("themechange"));
});

// ---- install, updates, offline ----------------------------------------------------------

onInstallable((ok) => $("#btn-install").classList.toggle("hidden", !ok));
$("#btn-install").addEventListener("click", async () => {
  if (!(await promptInstall())) toast('Use your browser menu → "Add to Home Screen"');
});

const updateSW = registerSW({
  onNeedRefresh() {
    toast("A new version of Atlas is ready.", "", { action: "Reload", onAction: () => updateSW(true), sticky: true });
  },
});

const updateOnline = () => $("#offline-banner").classList.toggle("hidden", navigator.onLine);
window.addEventListener("online", updateOnline);
window.addEventListener("offline", updateOnline);

// Desktop "Open with Atlas" (File Handling API): import the opened files.
if ("launchQueue" in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files?.length) return;
    const files = await Promise.all(params.files.map((h) => h.getFile()));
    window.__atlasLaunchFiles = files;
    location.hash = "#/import?launch=1";
  });
}

// ---- boot ----------------------------------------------------------------------------------

window.addEventListener("hashchange", route);
window.addEventListener("atlas:changed", () => {
  // Views re-render themselves on their next show; keep the current one fresh.
  const { view } = parseHash();
  if (!["welcome", "import", "setup", "settings", "places"].includes(view)) route();
});
updateOnline();
init()
  .then(route)
  .then(() => setTimeout(autoName, 1500))
  .catch((e) => {
    document.querySelector("#app").innerHTML = `<div class="page"><div class="notice err">Atlas could not start: ${String(e.message || e)}</div></div>`;
  });
