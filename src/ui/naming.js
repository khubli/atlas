// The OpenStreetMap naming job, shared by Setup and Settings. It keeps running
// while you move around the app; screens subscribe to its progress.

import { call, changed, query, rpc } from "../data/client.js";
import { plural, toast } from "./util.js";

let job = null; // { id, state: { done, total, found } }
const listeners = new Set();

export const namingState = () => (job ? { ...job.state } : null);

export function onNaming(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const emit = () => listeners.forEach((fn) => fn(namingState()));

/** Look up names for every place still without one. Resolves when done or stopped. */
export function startOsm(total = null, { quiet = false } = {}) {
  if (job) return job.promise;
  const { id, promise } = call("enrichOsm", [], (p) => {
    job.state = { done: p.done, total: p.total, found: p.found };
    emit();
  });
  job = { id, state: { done: 0, total, found: 0 } };
  job.promise = promise
    .then((r) => {
      toast(`Named ${plural(r.found, "place")} from OpenStreetMap`, "ok");
      return r;
    })
    .catch((e) => {
      if (!quiet) toast(e.message, "err");
    })
    .finally(() => {
      job = null;
      emit();
      changed({ method: "enrichOsm" });
    });
  emit();
  return job.promise;
}

export function stopOsm() {
  if (job) rpc("abort", job.id);
}

/**
 * Name places without being asked: after an import, and again on the next start
 * if a lookup was cut short. Off when you turn it off in Settings, for the demo,
 * and while offline.
 */
export async function autoName() {
  if (job || !navigator.onLine) return;
  try {
    const status = await query("status");
    if (status.empty || status.settings.demo || status.settings.autoNames === false) return;
    const pending = await rpc("pending");
    if (pending.osm > 0) startOsm(pending.osm, { quiet: true });
  } catch {
    // Naming is a nicety; never let it get in the way of starting up.
  }
}
