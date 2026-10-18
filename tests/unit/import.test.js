import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { androidExport, buildSegments, iosExport, placeId, takeoutExport } from "../../src/demo/generate.js";
import { readExport, UnsupportedFile } from "../../src/engine/formats/read.js";
import { Batch, Dataset, modeFor } from "../../src/engine/ingest.js";

const segments = buildSegments({ start: "2019-11-01", end: "2020-03-31" });
const blob = (obj) => new Blob([typeof obj === "string" ? obj : JSON.stringify(obj)]);

async function load(file, opts) {
  const batch = new Batch();
  const format = await readExport(file, batch, { offset: 330, ...opts });
  const ds = new Dataset();
  const record = ds.merge(batch, { format });
  return { ds, format, record, batch };
}

describe("export formats", () => {
  it("reads the Android export, including Google's HOME/WORK profile", async () => {
    const { ds, format } = await load(blob(androidExport(segments)));
    expect(format).toBe("android");
    expect(ds.visits.length).toBeGreaterThan(300);
    expect(ds.moves.length).toBeGreaterThan(300);
    expect(ds.points.t.length).toBeGreaterThan(1000);
    expect(ds.frequent[placeId("home")]).toBe("HOME");
    expect(ds.visits.find((v) => v.placeId === placeId("home")).semantic).toBe("HOME");
  });

  it("reads the iPhone export to the same visits and movements", async () => {
    const android = await load(blob(androidExport(segments)));
    const ios = await load(blob(iosExport(segments)));
    expect(ios.format).toBe("ios");
    expect(ios.ds.visits.map((v) => v.key)).toEqual(android.ds.visits.map((v) => v.key));
    expect(ios.ds.moves.map((m) => m.mode)).toEqual(android.ds.moves.map((m) => m.mode));
    expect(ios.ds.points.t.length).toBe(android.ds.points.t.length);
    expect(ios.ds.visits.find((v) => v.placeId === placeId("work")).semantic).toBe("WORK");
    const a = android.ds.visits[10];
    const b = ios.ds.visits[10];
    expect(b.lat).toBeCloseTo(a.lat, 5);
    expect(b.offset).toBe(a.offset);
  });

  it("reads a Takeout zip of monthly files, keeping Google's names", async () => {
    const files = Object.fromEntries(
      Object.entries(takeoutExport(segments)).map(([name, obj]) => [`Takeout/Location History/Semantic Location History/2020/${name}`, strToU8(JSON.stringify(obj))]),
    );
    files["Takeout/Location History/Records.json"] = strToU8('{"locations": []}');
    files["Takeout/Location History/Settings.json"] = strToU8("{}");
    const { ds, format } = await load(new Blob([zipSync(files)]));
    expect(format).toBe("takeout");
    const amber = ds.visits.find((v) => v.placeId === placeId("amber"));
    expect(amber.name).toBe("Amber Fort");
    expect(amber.address).toMatch(/Jaipur/);
    expect(ds.visits.find((v) => v.placeId === placeId("home")).semantic).toBe("HOME");
  });

  it("streams large files to the same result", async () => {
    const whole = await load(blob(androidExport(segments)));
    const streamed = await load(blob(androidExport(segments)), { streamAboveBytes: 0 });
    expect(streamed.format).toBe("android");
    expect(streamed.ds.visits.map((v) => v.key)).toEqual(whole.ds.visits.map((v) => v.key));
    expect(streamed.ds.frequent).toEqual(whole.ds.frequent);
    const iosStreamed = await load(blob(iosExport(segments)), { streamAboveBytes: 0 });
    expect(iosStreamed.ds.visits.length).toBe(whole.ds.visits.length);
  });

  it("explains files it can't use", async () => {
    await expect(load(blob('{"locations": [{"latitudeE7": 1}]}'))).rejects.toThrow(/Records\.json/);
    await expect(load(blob("{not json"))).rejects.toBeInstanceOf(UnsupportedFile);
    await expect(load(blob('{"hello": 1}'))).rejects.toThrow(/Timeline export/);
    await expect(load(blob("hello"))).rejects.toThrow(/not JSON/);
  });
});

describe("merging imports", () => {
  it("re-importing the same file adds nothing", async () => {
    const { ds } = await load(blob(androidExport(segments)));
    const again = new Batch();
    await readExport(blob(androidExport(segments)), again, { offset: 330 });
    expect(ds.merge(again).added).toEqual({ visits: 0, moves: 0, points: 0 });
  });

  it("a newer export adds only what is new", async () => {
    const older = segments.filter((s) => s.startTime < "2020-02-01");
    const { ds } = await load(blob(androidExport(older)));
    const before = ds.visits.length;
    const newer = new Batch();
    await readExport(blob(androidExport(segments)), newer, { offset: 330 });
    const record = ds.merge(newer);
    const full = await load(blob(androidExport(segments)));
    expect(record.added.visits).toBe(full.ds.visits.length - before);
    expect(ds.visits.length).toBe(full.ds.visits.length);
    expect(ds.imports).toHaveLength(2);
  });

  it("links nested visits to the visit containing them", async () => {
    const { ds } = await load(blob(androidExport(segments)));
    const nested = ds.visits.filter((v) => v.level > 0);
    expect(nested.length).toBeGreaterThan(0);
    for (const v of nested) {
      const parent = ds.visits.find((p) => p.key === v.parentKey);
      expect(parent.start).toBeLessThanOrEqual(v.start);
      expect(parent.end).toBeGreaterThanOrEqual(v.end);
    }
  });

  it("maps activity spellings from both phones to one mode", () => {
    expect(modeFor("IN_PASSENGER_VEHICLE")).toBe("car");
    expect(modeFor("in passenger vehicle")).toBe("car");
    expect(modeFor("flying")).toBe("flight");
    expect(modeFor("UNKNOWN_ACTIVITY_TYPE")).toBe("other");
  });
});

describe("Google Maps saved and labelled places (Takeout)", () => {
  it("reads both shapes, skipping Home/Work and places without a location", async () => {
    const savedFile = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [76.4600, 15.3350] },
          properties: { google_maps_url: "http://maps.google.com/?cid=1", location: { name: "Virupaksha Temple", address: "Hampi" } } },
        { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] },
          properties: { google_maps_url: "http://maps.google.com/?cid=2", location: { name: "Nowhere" } } },
      ],
    };
    const labelledFile = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [77.6411, 12.9719] }, properties: { name: "Home", address: "x" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [76.6552, 12.3052] }, properties: { name: "Grandma's place", address: "Mysuru" } },
      ],
    };
    const batch = new Batch();
    expect(await readExport(blob(savedFile), batch)).toBe("saved");
    expect(await readExport(blob(labelledFile), batch)).toBe("saved");
    expect(batch.saved.map((x) => [x.name, x.source])).toEqual([["Virupaksha Temple", "saved"], ["Grandma's place", "labelled"]]);
    expect(batch.visits).toHaveLength(0);
  });
});
