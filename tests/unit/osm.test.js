import { describe, expect, it, vi } from "vitest";
import { describe as describeOsm, enrichFromOsm, overpassQuery, pickFeature } from "../../src/engine/osm.js";

const fort = { type: "way", center: { lat: 26.9855, lon: 75.8512 }, tags: { name: "Amber Fort", historic: "castle" } };
const road = { type: "way", center: { lat: 26.9856, lon: 75.8513 }, tags: { name: "Amer Road", highway: "primary" } };
const cafe = { type: "node", lat: 26.9857, lon: 75.8516, tags: { name: "Chai Point", amenity: "cafe" } };
const shed = { type: "way", center: { lat: 26.98555, lon: 75.85132 }, tags: { name: "Guard House", building: "yes" } };

describe("OpenStreetMap matching", () => {
  it("prefers sights over cafes, and never picks a road", () => {
    expect(pickFeature(26.9855, 75.8513, [road, cafe, fort])).toMatchObject({ name: "Amber Fort", tags: { historic: "castle" } });
    // A cafe right there names the place; one ~37 m away is a neighbour, not where you were.
    expect(pickFeature(26.98568, 75.85155, [road, cafe])).toMatchObject({ name: "Chai Point" });
    expect(pickFeature(26.9855, 75.8513, [road, cafe])).toBeNull();
    expect(pickFeature(26.9855, 75.8513, [road])).toBeNull();
  });

  it("uses a named building only when very close", () => {
    expect(pickFeature(26.9855, 75.8513, [shed, road])).toMatchObject({ name: "Guard House" });
    expect(pickFeature(26.9860, 75.8513, [shed])).toBeNull();
  });

  it("ignores features out of range", () => {
    expect(pickFeature(27.5, 75.8513, [fort, cafe])).toBeNull();
  });

  it("asks for every point in one query", () => {
    const q = overpassQuery([[1, 2], [3, 4]]);
    expect(q).toContain("nwr(around:120,1.000000,2.000000)[name];");
    expect(q).toContain("out center tags;");
  });

  it("batches, reports progress and retries when the server is busy", async () => {
    const places = Array.from({ length: 25 }, (_, i) => ({ placeId: `p${i}`, lat: 26.9855, lng: 75.8513 }));
    const responses = [
      { ok: false, status: 429 },
      { ok: true, status: 200, json: async () => ({ elements: [fort] }) },
      { ok: true, status: 200, json: async () => ({ elements: [] }) },
    ];
    const fetchFn = vi.fn(async () => responses.shift());
    const results = {};
    const progress = [];
    await enrichFromOsm(places, { fetchFn, pauseMs: 0, onResult: (id, r) => (results[id] = r), onProgress: (d, n) => progress.push([d, n]) });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(results.p0.name).toBe("Amber Fort");
    expect(results.p24).toMatchObject({ area: null, near: null, v: 3 });
    expect(results.p24.name).toBeUndefined();
    expect(progress).toEqual([[20, 25], [25, 25]]);
  });
});

describe("labels for places nothing names", () => {
  const area = (name, place, lat, lon) => ({ type: "node", lat, lon, tags: { name, place } });
  const temple = { type: "way", center: { lat: 15.3350, lon: 76.4600 }, tags: { name: "Virupaksha Temple", historic: "temple" } };

  it("finds the neighbourhood, preferring the finer one", () => {
    const els = [area("Indiranagar", "suburb", 12.9719, 77.6412), area("HAL 2nd Stage", "neighbourhood", 12.9764, 77.6464), area("Bengaluru", "city", 12.97, 77.59)];
    expect(describeOsm(12.9724, 77.6424, els)).toMatchObject({ area: "Indiranagar" });
    expect(describeOsm(12.9759, 77.6459, els).area).toBe("HAL 2nd Stage");
  });

  it("names an unnamed spot after a landmark within walking distance", () => {
    const r = describeOsm(15.3380, 76.4625, [temple]);
    expect(r.name).toBeUndefined();
    expect(r.near).toBe("Virupaksha Temple");
    expect(describeOsm(15.40, 76.50, [temple]).near).toBeNull();
  });

  it("asks Overpass for neighbourhoods and landmarks too", () => {
    const q = overpassQuery([[12.97, 77.64]]);
    expect(q).toContain('[place~"^(suburb|neighbourhood');
    expect(q).toContain("[historic]");
  });
});
