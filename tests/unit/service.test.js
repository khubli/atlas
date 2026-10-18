import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { androidExport, buildSegments, placeDetails, placeId } from "../../src/demo/generate.js";
import { openStore } from "../../src/store/db.js";
import { Service } from "../../src/worker/service.js";

const gazetteer = JSON.parse(readFileSync(fileURLToPath(new URL("../../public/geo/places.json", import.meta.url)), "utf8"));
const file = (obj, name = "Timeline.json") => new File([JSON.stringify(obj)], name);
const segments = buildSegments({ start: "2019-11-01", end: "2020-03-31" });

let n = 0;
async function fresh() {
  const store = await openStore(`atlas-test-${++n}`);
  const service = new Service({ store, loadGazetteer: async () => gazetteer, offset: 330 });
  await service.init();
  return { store, service };
}

describe("service", () => {
  it("starts empty, imports, and survives a restart", async () => {
    const { store, service } = await fresh();
    expect(service.status().empty).toBe(true);
    const stages = [];
    const { records } = await service.importFiles([file(androidExport(segments))], (p) => stages.push(p.stage));
    expect(records[0].format).toBe("android");
    expect(stages).toEqual(expect.arrayContaining(["reading", "merging", "saving", "analysing"]));
    const trips = service.query("overview").totals.journeys;
    expect(trips).toBeGreaterThan(0);

    const again = new Service({ store, loadGazetteer: async () => gazetteer, offset: 330 });
    await again.init();
    expect(again.query("overview").totals.journeys).toBe(trips);
    expect(again.dataset.points.t).toBeInstanceOf(Float64Array);
  });

  it("labels, trip edits and the lens persist", async () => {
    const { store, service } = await fresh();
    await service.importFiles([file(androidExport(segments))]);
    const id = placeId("amber");
    await service.setLabel(id, { name: "Amer Fort", kind: "explored" });
    const t = service.query("journeys").journeys.find((j) => j.start_date === "2019-12-20");
    await service.setTripEdit(t.id, { title: "Rajasthan with family" });
    await service.setSettings({ lens: { awayKm: 200 }, cityAliases: { Hosapete: "Hampi" } });

    const again = new Service({ store, loadGazetteer: async () => gazetteer, offset: 330 });
    await again.init();
    expect(again.query("place", [id])).toMatchObject({ name: "Amer Fort", name_source: "you", kind_source: "you" });
    expect(again.query("journeys").journeys.find((j) => j.id === t.id).title).toBe("Rajasthan with family");
    expect(again.settings().lens.awayKm).toBe(200);
    expect(again.settings().lens.minHours).toBe(3);
    await again.setLabel(id, { name: null, kind: null });
    expect(again.labels[id]).toBeUndefined();
  });

  it("backs up and restores everything except the Google key", async () => {
    const { service } = await fresh();
    await service.importFiles([file(androidExport(segments))]);
    await service.setLabel(placeId("amber"), { note: "Sunrise" });
    await service.setSettings({ googleKey: "secret-key" });
    const blob = await service.exportBackup();
    expect(new Uint8Array(await blob.slice(0, 2).arrayBuffer())).toEqual(new Uint8Array([0x1f, 0x8b]));
    expect(await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text()).not.toContain("secret-key");

    const { service: other } = await fresh();
    const res = await other.restore(blob);
    expect(res.kind).toBe("backup");
    expect(other.query("overview").totals).toEqual(service.query("overview").totals);
    expect(other.labels[placeId("amber")].note).toBe("Sunrise");
    expect(other.dataset.points.t.length).toBe(service.dataset.points.t.length);
  });

  it("imports a labels file from Atlas 0.4 (your Google names and fixed states)", async () => {
    const { service } = await fresh();
    await service.importFiles([file(androidExport(segments))]);
    const labels = {
      format: "atlas-labels",
      places: { [placeId("amber")]: { name: "Amber Palace", types: ["historical_landmark"], state: "Rajasthan", city: "Amer" } },
    };
    const res = await service.restore(new Blob([JSON.stringify(labels)]));
    expect(res).toMatchObject({ kind: "labels", places: 1 });
    expect(service.query("place", [placeId("amber")])).toMatchObject({ name: "Amber Palace", name_source: "google", city: "Amer" });
  });

  it("lists naming candidates and records Google answers", async () => {
    const { service } = await fresh();
    await service.importFiles([file(androidExport(segments))]);
    const before = service.pending();
    expect(before.google).toBeGreaterThan(10);
    expect(service.candidates("google").some((c) => c.placeId === placeId("home"))).toBe(false);
    const details = placeDetails();
    const some = Object.fromEntries(service.candidates("google").slice(0, 5).map((c) => [c.placeId, details[c.placeId] ?? null]));
    const after = await service.saveGoogle(some, 5);
    expect(after.google).toBe(before.google - 5);
    expect(service.settings().googleUsage.calls).toBe(5);
    expect(service.settings().hasGoogleKey).toBe(false);
  });

  it("forgets everything on request", async () => {
    const { store, service } = await fresh();
    await service.importFiles([file(androidExport(segments))]);
    await service.clearAll();
    expect(service.status().empty).toBe(true);
    expect(await store.get("dataset")).toBeUndefined();
  });

  it("imports the demo with its place names", async () => {
    const { service } = await fresh();
    await service.importDemo(file(androidExport(segments), "demo.json"), placeDetails());
    expect(service.settings().demo).toBe(true);
    expect(service.query("place", [placeId("amber")]).name).toBe("Amber Fort");
  });
});
