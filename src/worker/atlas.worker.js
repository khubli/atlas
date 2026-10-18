// Web Worker entry: message RPC around Service.
//   in:  { id, method, args }
//   out: { id, result } | { id, error } | { id, progress }

import { openStore } from "../store/db.js";
import { Service } from "./service.js";

const ALLOWED = new Set([
  "status", "query", "importFiles", "importDemo", "setLabel", "bulkLabel", "setTripEdit", "setSettings",
  "pending", "candidates", "enrichOsm", "googleKey", "saveGoogle", "exportBackup", "restore", "clearAll", "abort",
]);

let service = null;
let ready = null;
const running = new Map();

async function start({ geoUrl, offset }) {
  const store = await openStore();
  service = new Service({
    store,
    offset,
    loadGazetteer: async () => {
      const res = await fetch(geoUrl);
      if (!res.ok) throw new Error(`Could not load the offline gazetteer (HTTP ${res.status})`);
      return res.json();
    },
  });
  return service.init();
}

self.onmessage = async (event) => {
  const { id, method, args = [] } = event.data;
  const progress = (p) => self.postMessage({ id, progress: p });
  try {
    if (method === "init") {
      ready ??= start(args[0]);
      self.postMessage({ id, result: await ready });
      return;
    }
    if (!ALLOWED.has(method)) throw new Error(`Unknown method: ${method}`);
    await ready;
    let result;
    if (method === "query") result = service.query(args[0], args[1]);
    else if (method === "importFiles") result = await service.importFiles(args[0], progress);
    else if (method === "importDemo") {
      const [timelineUrl, placesUrl] = args;
      const [timeline, places] = await Promise.all([
        fetch(timelineUrl).then((r) => r.blob()),
        fetch(placesUrl).then((r) => r.json()),
      ]);
      result = await service.importDemo(new File([timeline], "demo-timeline.json"), places, progress);
    } else if (method === "enrichOsm") {
      const controller = new AbortController();
      running.set(id, controller);
      try {
        result = await service.enrichOsm(progress, controller.signal);
      } finally {
        running.delete(id);
      }
    } else if (method === "abort") {
      running.get(args[0])?.abort();
      result = true;
    } else {
      result = await service[method](...args);
    }
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
