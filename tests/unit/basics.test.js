import { describe, expect, it } from "vitest";
import { categoryFromOsm, categoryFromTypes, ROUTINE_TYPES, STRONG_TYPES, themeFor } from "../../src/engine/classify.js";
import { haversineKm, parseLatLng, simplifySegments, splitTrack } from "../../src/engine/geo.js";
import { localIso, localMinuteId, parseTime, weekKey } from "../../src/engine/time.js";
import { getGeocoder } from "./helpers.js";

describe("coordinates", () => {
  it.each([
    ["12.9716°, 77.5946°", [12.9716, 77.5946]],
    ["12.9716Â°, 77.5946Â°", [12.9716, 77.5946]],
    ["geo:12.9716,77.5946", [12.9716, 77.5946]],
    ["-33.8568°, 151.2153°", [-33.8568, 151.2153]],
    [{ latitudeE7: 269855000, longitudeE7: 758513000 }, [26.9855, 75.8513]],
    [{ latE7: 4294967296 - 338568000, lngE7: 1512153000 }, [-33.8568, 151.2153]], // unsigned-wrapped
    [{ latLng: "1.5°, 2.5°" }, [1.5, 2.5]],
    ["", null],
    ["12.9°", null],
    ["123.0°, 77.0°", null],
  ])("%j", (input, expected) => {
    const got = parseLatLng(input);
    if (expected === null) expect(got).toBeNull();
    else expect(got.map((x) => Number(x.toFixed(4)))).toEqual(expected);
  });

  it("measures distance", () => {
    expect(haversineKm(12.97194, 77.64115, 12.3052, 76.6552)).toBeCloseTo(130.15, 1);
    expect(haversineKm(null, 1, 2, 3)).toBeNull();
  });

  it("splits tracks at gaps and jumps, then fits a point budget", () => {
    const t0 = Date.parse("2023-01-01T04:30:00Z");
    const pts = [0, 1, 2, 3, 4].map((i) => [t0 + i * 300000, 12.9 + i * 0.01, 77.6]);
    pts.push([t0 + 4 * 300000 + 3 * 3600000, 26.9, 75.8], [t0 + 5 * 300000 + 3 * 3600000, 26.91, 75.81], [t0 + 6 * 300000 + 3 * 3600000, 26.92, 75.82]);
    const segs = splitTrack(pts);
    expect(segs.map((s) => s.length)).toEqual([5, 3]);
    // More segments than the budget can hold: must terminate and stay within it.
    const many = Array.from({ length: 100 }, () => segs).flat();
    const out = simplifySegments(many, 60);
    expect(out.reduce((s, x) => s + x.length, 0)).toBeLessThanOrEqual(60);
    expect(out.every((s) => s.length >= 2)).toBe(true);
  });
});

describe("time", () => {
  it("keeps the offset where it happened", () => {
    const t = parseTime("2024-06-12T21:00:00.000+08:00");
    expect(t.offset).toBe(480);
    expect(localIso(t.ms, t.offset)).toBe("2024-06-12T21:00:00+08:00");
    expect(parseTime("2024-06-12T15:30:00Z").offset).toBe(0);
    expect(parseTime("2024-06-12T21:00:00", 330)).toEqual({ ms: Date.parse("2024-06-12T15:30:00Z"), offset: 330 });
    expect(parseTime("nonsense")).toBeNull();
  });

  it("makes stable ids and week keys", () => {
    const t = parseTime("2019-12-20T05:30:00+05:30");
    expect(localMinuteId(t.ms, t.offset)).toBe(201912200530);
    expect(weekKey(Date.parse("2023-01-02T00:00:00Z"), 0)).toBe("2023-W01");
    expect(weekKey(Date.parse("2023-01-01T00:00:00Z"), 0)).toBe("2022-W52");
  });
});

describe("classification", () => {
  it("prefers specific types, regardless of order", () => {
    const temple = ["tourist_attraction", "place_of_worship", "hindu_temple"];
    expect(categoryFromTypes(temple).category).toBe("hindu_temple");
    expect(categoryFromTypes([...temple].reverse()).category).toBe("hindu_temple");
    expect(categoryFromTypes(["restaurant", "lodging", "hotel"]).category).toBe("hotel");
  });

  it("flags routine places, but sights beat routine tags", () => {
    expect(categoryFromTypes(["gym", "health"])).toEqual({ category: "gym", routine: true });
    expect(categoryFromTypes(["cafe", "atm"]).routine).toBe(true);
    expect(categoryFromTypes(["museum", "parking"])).toEqual({ category: "museum", routine: false });
    expect(categoryFromTypes(["south_indian_restaurant"]).category).toBe("restaurant");
    expect(categoryFromTypes(["point_of_interest"]).category).toBeNull();
  });

  it("maps OpenStreetMap tags onto the same categories", () => {
    expect(categoryFromOsm({ historic: "fort", name: "Amber Fort" }).category).toBe("fort");
    expect(categoryFromOsm({ amenity: "place_of_worship", religion: "hindu" }).category).toBe("hindu_temple");
    expect(categoryFromOsm({ tourism: "hotel" }).category).toBe("hotel");
    expect(categoryFromOsm({ amenity: "fuel" })).toEqual({ category: "gas_station", routine: true });
    expect(themeFor("fort")).toBe("landmark");
    expect(themeFor("chinese_restaurant")).toBe("food");
  });

  it("keeps strong and routine types apart", () => {
    expect(STRONG_TYPES.filter((t) => ROUTINE_TYPES.has(t))).toEqual([]);
  });
});

describe("offline geocoder", () => {
  it.each([
    ["Amber Fort", 26.9855, 75.8513, "Jaipur", "Rajasthan", "India"],
    ["Whitefield", 12.9698, 77.7499, "Bengaluru", "Karnataka", "India"],
    ["Taj Mahal", 27.1751, 78.0421, "Agra", "Uttar Pradesh", "India"],
    ["Changi", 1.3644, 103.9915, "Singapore", null, "Singapore"],
    ["Golden Gate", 37.8199, -122.4783, "San Francisco", "California", "United States"],
    ["Nandi Hills (beyond Bengaluru's reach)", 13.3702, 77.6835, "Chik Ballapur", "Karnataka", "India"],
  ])("%s", (_, lat, lng, city, state, country) => {
    expect(getGeocoder().lookup(lat, lng)).toMatchObject({ city, state, country });
  });

  it("labels nothing far out at sea", () => {
    expect(getGeocoder().lookup(0, -30)).toMatchObject({ city: null, state: null, country: null });
  });
});
