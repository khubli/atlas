import { describe, expect, it } from "vitest";
import { Atlas } from "../../src/engine/atlas.js";
import { at, getGeocoder, MYSURU, Timeline } from "./helpers.js";

const CHENNAI = [13.0827, 80.2707];
const BENGALURU = [12.97194, 77.64115];
const BLR_OFFICE = [12.9698, 77.7499];
const HYDERABAD = [17.3850, 78.4867];
const HYD_OLD = [17.4400, 78.3489]; // a Hyderabad place visited once, long ago, that Google still calls HOME

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Live somewhere: nights at home and, on weekdays, a working day at the office. */
function live(tl, { home, homeAt, office, officeAt, from, days }) {
  for (let i = 0; i < days; i++) {
    const day = addDays(from, i);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (office && weekday >= 1 && weekday <= 5) tl.visit(office, at(day, "09:30"), at(day, "18:00"), officeAt);
    tl.visit(home, at(day, "19:30"), at(addDays(day, 1), "08:30"), homeAt);
  }
  return tl;
}

function atlasFor(tl, frequent = {}) {
  const dataset = tl.dataset();
  Object.assign(dataset.frequent, frequent);
  return new Atlas({ dataset, geocoder: getGeocoder() });
}

describe("home from where you sleep", () => {
  // Chennai, then Bengaluru, then Hyderabad; Google's HOME label points at a place
  // in Hyderabad last seen once, years before.
  const timeline = () => {
    const tl = new Timeline().visit("hyd-old", at("2013-12-10", "10:00"), at("2013-12-10", "12:00"), HYD_OLD);
    live(tl, { home: "maa-home", homeAt: CHENNAI, from: "2014-01-01", days: 120 });
    live(tl, { home: "blr-home", homeAt: BENGALURU, office: "blr-office", officeAt: BLR_OFFICE, from: "2014-05-01", days: 123 });
    tl.visit("mysuru", at("2014-06-14", "11:00"), at("2014-06-15", "17:00"), MYSURU);
    live(tl, { home: "hyd-home", homeAt: HYDERABAD, from: "2014-09-01", days: 120 });
    return tl;
  };

  it("finds each home over time, not the stale HOME label", () => {
    const atlas = atlasFor(timeline(), { "hyd-old": "HOME" });
    expect(atlas.homes().map((h) => h.place_id)).toEqual(["maa-home", "blr-home", "hyd-home"]);
    expect(atlas.homes().map((h) => h.city)).toEqual(["Chennai", "Bengaluru", "Hyderabad"]);
    expect(atlas.places.get("hyd-old").kind).not.toBe("home");
    for (const id of ["maa-home", "blr-home", "hyd-home"]) expect(atlas.places.get(id).kind).toBe("home");
  });

  it("trips are measured from the home of the time", () => {
    const atlas = atlasFor(timeline(), { "hyd-old": "HOME" });
    // Living in three cities is not three trips; the weekend in Mysuru is the only trip.
    expect(atlas.trips.map((t) => t.start_date)).toEqual(["2014-06-14"]);
  });

  it("finds work from long weekday days, without a WORK label", () => {
    const atlas = atlasFor(timeline());
    expect(atlas.places.get("blr-office").kind).toBe("work");
    const everyday = atlas.everyday();
    expect(everyday.has_work).toBe(true);
    expect(everyday.commute.days).toBeGreaterThan(60);
  });

  it("counts every night of a long stay", () => {
    const tl = new Timeline().visit("home", at("2024-03-01", "18:00"), at("2024-03-04", "09:00"), BENGALURU);
    const atlas = atlasFor(tl);
    expect(atlas.places.get("home").nights).toBe(3);
  });

  it("treats one building under two place IDs as one home", () => {
    const tl = new Timeline();
    live(tl, { home: "flat-a", homeAt: BENGALURU, from: "2024-01-01", days: 40 });
    live(tl, { home: "flat-b", homeAt: [BENGALURU[0] + 0.0004, BENGALURU[1]], from: "2024-02-10", days: 40 });
    const atlas = atlasFor(tl);
    expect(atlas.places.get("flat-a").kind).toBe("home");
    expect(atlas.places.get("flat-b").kind).toBe("home");
    expect(atlas.trips).toHaveLength(0);
  });

  it("your label wins: a home you mark as family stops being home", () => {
    const tl = new Timeline();
    live(tl, { home: "parents", homeAt: MYSURU, from: "2024-01-01", days: 60 });
    live(tl, { home: "mine", homeAt: BENGALURU, from: "2024-03-01", days: 60 });
    const atlas = atlasFor(tl);
    expect(atlas.homes().map((h) => h.place_id)).toEqual(["parents", "mine"]);
    atlas.update({ labels: { parents: { kind: "family" } } });
    expect(atlas.homes().map((h) => h.place_id)).toEqual(["mine"]);
    expect(atlas.places.get("parents").kind).toBe("family");
  });
});

describe("home when Google scatters your nights", () => {
  // Real exports put the same night at home under several nearby place IDs,
  // hundreds of metres apart (GPS drift), so no single ID dominates a month.
  const drift = [[0, 0], [0.003, 0.001], [-0.002, 0.003], [0.004, -0.003], [-0.004, -0.002], [0.001, 0.005], [-0.005, 0.004], [0.005, 0.004]];
  function scattered(tl, prefix, [lat, lng], from, days, office) {
    for (let i = 0; i < days; i++) {
      const day = addDays(from, i);
      const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
      if (office && weekday >= 1 && weekday <= 5) tl.visit(office.id, at(day, "09:30"), at(day, "18:00"), office.at);
      const [dl, dg] = drift[(i * 5 + 3) % drift.length];
      tl.visit(`${prefix}-${(i * 5 + 3) % drift.length}`, at(day, "19:30"), at(addDays(day, 1), "08:30"), [lat + dl, lng + dg]);
    }
    return tl;
  }
  const timeline = () => {
    const tl = new Timeline();
    scattered(tl, "maa", CHENNAI, "2014-01-01", 120);
    scattered(tl, "blr", BENGALURU, "2014-05-01", 123, { id: "blr-office", at: BLR_OFFICE });
    scattered(tl, "hyd", HYDERABAD, "2014-09-01", 120);
    return tl;
  };

  it("still finds each home over time", () => {
    const atlas = atlasFor(timeline());
    expect(atlas.homes().map((h) => h.city)).toEqual(["Chennai", "Bengaluru", "Hyderabad"]);
    expect(atlas.places.get("blr-office").kind).toBe("work");
  });

  it("living somewhere isn't a string of trips", () => {
    expect(atlasFor(timeline()).trips).toHaveLength(0);
  });

  it("the places you slept at are home, not family homes", () => {
    const atlas = atlasFor(timeline());
    const kinds = [...atlas.places.values()].filter((p) => /^(maa|blr|hyd)-\d/.test(p.placeId)).map((p) => p.kind);
    expect(new Set(kinds)).toEqual(new Set(["home"]));
  });
});

describe("tidier places", () => {
  it("merges one building under several IDs, and keeps two named shops apart", () => {
    const tl = new Timeline();
    live(tl, { home: "home", homeAt: BENGALURU, from: "2024-01-01", days: 60 });
    for (const [id, dLat] of [["gym-a", 0], ["gym-b", 0.0004], ["gym-c", 0.0007]]) {
      for (let w = 0; w < 6; w++) tl.visit(id, at(addDays("2024-01-02", w * 7), "07:00"), at(addDays("2024-01-02", w * 7), "08:00"), [12.9800 + dLat, 77.6400]);
    }
    const atlas = atlasFor(tl);
    const rows = atlas.placesList().places;
    const gyms = rows.filter((r) => r.place_id.startsWith("gym"));
    expect(gyms).toHaveLength(1);
    expect(gyms[0].visits).toBe(18);
    expect(gyms[0].merged).toBe(2);
    // Named differently: not merged.
    atlas.update({ labels: { "gym-b": { name: "Cafe Next Door" } } });
    expect(atlas.placesList().places.filter((r) => r.place_id.startsWith("gym"))).toHaveLength(2);
  });

  it("folds one-off stops away from counts", () => {
    const tl = new Timeline();
    live(tl, { home: "home", homeAt: BENGALURU, from: "2024-01-01", days: 60 });
    tl.visit("fuel", at("2024-01-20", "10:00"), at("2024-01-20", "10:12"), MYSURU);
    tl.visit("palace", at("2024-01-21", "10:00"), at("2024-01-21", "13:00"), [12.3052, 76.6552 + 0.05]);
    const atlas = atlasFor(tl);
    expect(atlas.places.get("fuel").oneoff).toBe(true);
    expect(atlas.places.get("palace").oneoff).toBe(false);
    expect(atlas.overview().totals.oneoff_places).toBe(1);
  });
});

describe("names from your Google Maps saved places", () => {
  it("names the visited place at the same spot, your labels first", () => {
    const tl = new Timeline();
    live(tl, { home: "home", homeAt: BENGALURU, from: "2024-01-01", days: 40 });
    tl.visit("temple", at("2024-01-20", "10:00"), at("2024-01-20", "12:00"), [15.3350, 76.4600]);
    tl.visit("nani", at("2024-01-21", "10:00"), at("2024-01-21", "20:00"), [12.3052, 76.6552]);
    const dataset = tl.dataset();
    const atlas = new Atlas({
      dataset, geocoder: getGeocoder(),
      google: { temple: { name: "Sri Virupaksha Temple" } },
      saved: [
        { name: "Virupaksha Temple", lat: 15.33502, lng: 76.46001, source: "saved" },
        { name: "Grandma's place", lat: 12.30521, lng: 76.65519, source: "labelled" },
        { name: "Somewhere else", lat: 15.40, lng: 76.50, source: "saved" },
      ],
    });
    expect(atlas.places.get("temple").name).toBe("Virupaksha Temple");
    expect(atlas.places.get("temple").nameSource).toBe("saved");
    expect(atlas.places.get("nani").name).toBe("Grandma's place");
    atlas.update({ labels: { temple: { name: "Hampi temple" } } });
    expect(atlas.places.get("temple").name).toBe("Hampi temple");
  });
});
