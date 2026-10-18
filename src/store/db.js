// Everything Atlas keeps lives in this browser, in one IndexedDB key-value
// store. Nothing is sent anywhere.
//   dataset    visits, movements, GPS points, import log
//   labels     your names, kinds, themes, hidden flags, notes (by place id)
//   google     Google Places answers (by place id)
//   osm        OpenStreetMap answers (by place id)
//   saved      your Google Maps saved and labelled places (from Takeout)
//   tripEdits  your trip renames and hidden trips (by trip id)
//   settings   trip lens, city aliases, enrichment choices

import { openDB } from "idb";

const DB_NAME = "atlas";
const STORE = "kv";
export const KEYS = ["dataset", "labels", "google", "osm", "saved", "tripEdits", "settings"];

export async function openStore(name = DB_NAME) {
  const db = await openDB(name, 1, {
    upgrade(d) {
      d.createObjectStore(STORE);
    },
  });
  return {
    get: (key) => db.get(STORE, key),
    put: (key, value) => db.put(STORE, value, key),
    async getAll() {
      const out = {};
      for (const key of KEYS) out[key] = await db.get(STORE, key);
      return out;
    },
    async clear() {
      await db.clear(STORE);
    },
    close: () => db.close(),
  };
}
