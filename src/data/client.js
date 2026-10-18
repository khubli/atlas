// Main-thread side of the data worker. Query results are memoised until
// something changes (an import, a label, a setting).

const worker = new Worker(new URL("../worker/atlas.worker.js", import.meta.url), { type: "module" });
const pending = new Map();
let seq = 0;

worker.onmessage = (event) => {
  const { id, result, error, progress } = event.data;
  const p = pending.get(id);
  if (!p) return;
  if (progress) return p.onProgress?.(progress);
  pending.delete(id);
  if (error) p.reject(new Error(error));
  else p.resolve(result);
};

/** Start a call; returns { id, promise } so long jobs can be aborted. */
export function call(method, args = [], onProgress) {
  const id = ++seq;
  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, method, args });
  });
  return { id, promise };
}

export const rpc = (method, ...args) => call(method, args).promise;

let version = 0;
const memo = new Map();

/** Bumped on every change; views compare it to decide whether to re-render. */
export const dataVersion = () => version;

export function query(name, ...args) {
  const key = `${version}:${name}:${JSON.stringify(args)}`;
  if (!memo.has(key)) {
    const p = rpc("query", name, args).catch((e) => {
      memo.delete(key);
      throw e;
    });
    memo.set(key, p);
  }
  return memo.get(key);
}

/** Call after any write: drops memoised queries and tells open views. */
export function changed(detail = {}) {
  version++;
  memo.clear();
  window.dispatchEvent(new CustomEvent("atlas:changed", { detail }));
}

/** Writes that change what queries return. */
export async function mutate(method, ...args) {
  const result = await rpc(method, ...args);
  changed({ method });
  return result;
}

let started = null;
export function init() {
  started ??= rpc("init", {
    geoUrl: new URL("geo/places.json", document.baseURI).href,
    offset: -new Date().getTimezoneOffset(),
  });
  return started;
}
