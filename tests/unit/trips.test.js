import { describe, expect, it } from "vitest";
import { AIRPORT, at, HOME, JAIPUR, MYSURU, Timeline, UDAIPUR } from "./helpers.js";

const named = { amber: { name: "Amber Fort" }, hotel: { name: "Samode Haveli" }, palace: { name: "City Palace" } };

describe("trip detection (ported from the 0.4 pipeline)", () => {
  it("an overnight trip includes the airport and the drive home", () => {
    const tl = new Timeline()
      .home(at("2023-01-01"), at("2023-01-05", "05:00"))
      .visit("airport", at("2023-01-05", "05:45"), at("2023-01-05", "07:00"), AIRPORT)
      .activity(at("2023-01-05", "07:00"), at("2023-01-05", "09:30"), AIRPORT, JAIPUR, 1500, "FLYING")
      .visit("amber", at("2023-01-05", "10:00"), at("2023-01-05", "13:00"), JAIPUR)
      .visit("hotel", at("2023-01-05", "14:00"), at("2023-01-07", "09:00"), [26.93, 75.83])
      .activity(at("2023-01-07", "09:00"), at("2023-01-07", "15:00"), JAIPUR, UDAIPUR, 400)
      .visit("palace", at("2023-01-07", "15:30"), at("2023-01-07", "18:00"), UDAIPUR)
      .home(at("2023-01-07", "23:00"), at("2023-01-10", "09:00"));
    const atlas = tl.atlas({ google: named });
    const trips = atlas.trips;
    expect(trips).toHaveLength(1);
    const j = atlas.tripSummary(trips[0]);
    expect(j.id).toBe(202301050500);
    expect(j.start_time).toBe("2023-01-05T05:00:00+05:30");
    expect(j.end_time).toBe("2023-01-07T23:00:00+05:30");
    expect([j.nights, j.kind]).toEqual([2, "overnight"]);
    expect(j.title).toBe("Jaipur & Udaipur");
    expect(j.primary_state).toBe("Rajasthan");
    expect(j.distance_km).toBe(1900);
    expect(j.transport).toEqual({ flight: 1500, car: 400 });
    expect(atlas.journey(j.id).visits.map((v) => v.place_id)).toEqual(["airport", "amber", "hotel", "palace"]);
  });

  it("a day trip; without movement records distance is home -> stops -> home", () => {
    const atlas = new Timeline()
      .home(at("2023-02-01"), at("2023-02-04", "07:00"))
      .visit("mysore", at("2023-02-04", "10:00"), at("2023-02-04", "15:00"), MYSURU)
      .home(at("2023-02-04", "19:00"), at("2023-02-06", "08:00"))
      .atlas();
    const [t] = atlas.trips;
    expect([t.nights, t.kind]).toEqual([0, "day_trip"]);
    expect(t.distance_km).toBeCloseTo(2 * t.max_distance_km, 0);
  });

  it("a far-away office is not a trip while work counts as home base", () => {
    const office = [13.35, 77.1]; // ~70 km away
    const tl = new Timeline().home(at("2023-02-01"), at("2023-02-01", "07:00"));
    for (const d of ["01", "02", "03"]) {
      tl.work(at(`2023-02-${d}`, "09:00"), at(`2023-02-${d}`, "18:00"));
      tl.segments[tl.segments.length - 1].visit.topCandidate.placeLocation.latLng = `${office[0]}°, ${office[1]}°`;
      tl.home(at(`2023-02-${d}`, "20:00"), at(`2023-02-${Number(d) + 1}`.replace(/-(\d)$/, "-0$1"), "07:00"));
    }
    expect(tl.atlas().trips).toEqual([]);
    // ...but it is, when the user says work is not a base.
    expect(tl.atlas({ lens: { workIsBase: false } }).trips).toHaveLength(3);
  });

  it("short hops are dropped unless the lens allows them", () => {
    const tl = new Timeline()
      .home(at("2023-02-01"), at("2023-02-01", "09:00"))
      .visit("mysore", at("2023-02-01", "09:30"), at("2023-02-01", "10:30"), MYSURU)
      .home(at("2023-02-01", "11:00"), at("2023-02-02", "07:00"));
    expect(tl.atlas().trips).toEqual([]);
    expect(tl.atlas({ lens: { minHours: 1 } }).trips).toHaveLength(1);
  });

  it("a layover through the home airport stays one trip", () => {
    const atlas = new Timeline()
      .home(at("2023-03-01"), at("2023-03-01", "06:00"))
      .visit("jaipur", at("2023-03-01", "10:00"), at("2023-03-03", "08:00"), JAIPUR)
      .visit("airport", at("2023-03-03", "11:00"), at("2023-03-03", "14:00"), AIRPORT)
      .visit("udaipur", at("2023-03-03", "17:00"), at("2023-03-05", "10:00"), UDAIPUR)
      .home(at("2023-03-05", "15:00"), at("2023-03-07", "08:00"))
      .atlas();
    expect(atlas.trips).toHaveLength(1);
    expect(atlas.trips[0].nights).toBe(4);
  });

  it("going home between trips splits them", () => {
    const atlas = new Timeline()
      .home(at("2023-03-01"), at("2023-03-01", "06:00"))
      .visit("jaipur", at("2023-03-01", "10:00"), at("2023-03-03", "08:00"), JAIPUR)
      .home(at("2023-03-03", "12:00"), at("2023-03-03", "15:00"))
      .visit("udaipur", at("2023-03-03", "19:00"), at("2023-03-05", "10:00"), UDAIPUR)
      .home(at("2023-03-05", "15:00"), at("2023-03-07", "08:00"))
      .atlas();
    const trips = atlas.trips.map((t) => atlas.tripSummary(t));
    expect(trips).toHaveLength(2);
    expect(trips[0].end_time).toBe("2023-03-03T12:00:00+05:30");
    expect(trips[1].start_time).toBe("2023-03-03T15:00:00+05:30");
  });

  it("a week of silence in the data splits a trip", () => {
    const atlas = new Timeline()
      .home(at("2023-03-01"), at("2023-03-01", "06:00"))
      .visit("jaipur", at("2023-03-01", "10:00"), at("2023-03-02", "08:00"), JAIPUR)
      .visit("udaipur", at("2023-03-09", "10:00"), at("2023-03-10", "10:00"), UDAIPUR)
      .home(at("2023-03-10", "15:00"), at("2023-03-12", "08:00"))
      .atlas();
    expect(atlas.trips).toHaveLength(2);
  });

  it("moving house moves home", () => {
    const tl = new Timeline()
      .home(at("2022-12-30"), at("2022-12-30", "08:00"))
      .home(at("2022-12-31"), at("2022-12-31", "08:00"))
      .home(at("2023-01-01"), at("2023-01-03", "08:00"));
    for (const d of ["03", "04", "05"]) tl.visit("newhome", at(`2023-01-${d}`, "10:00"), at(`2023-01-${d}`, "23:00"), JAIPUR, "HOME");
    tl.visit("udaipur", at("2023-01-06", "10:00"), at("2023-01-07", "10:00"), UDAIPUR);
    tl.visit("newhome", at("2023-01-07", "20:00"), at("2023-01-08", "09:00"), JAIPUR, "HOME");
    const atlas = tl.atlas();
    expect(atlas.trips).toHaveLength(1);
    expect(atlas.trips[0].start_date).toBe("2023-01-05");
    expect(atlas.homes().map((h) => h.place_id)).toEqual(["home", "newhome"]);
  });

  it("trip ids survive recomputation", () => {
    const tl = new Timeline()
      .home(at("2023-02-01"), at("2023-02-04", "07:00"))
      .visit("mysore", at("2023-02-04", "10:00"), at("2023-02-04", "15:00"), MYSURU)
      .home(at("2023-02-04", "19:00"), at("2023-02-06", "08:00"));
    const atlas = tl.atlas();
    const first = atlas.trips.map((t) => t.id);
    atlas.update({ labels: { mysore: { name: "Mysore Palace" } } });
    expect(atlas.trips.map((t) => t.id)).toEqual(first);
    expect(first).toEqual([202302040700]);
  });
});

describe("the trip lens", () => {
  const tl = () => new Timeline()
    .home(at("2023-02-01"), at("2023-02-04", "07:00"))
    .visit("nandi", at("2023-02-04", "08:00"), at("2023-02-04", "12:00"), [13.3702, 77.6835]) // ~45 km
    .home(at("2023-02-04", "14:00"), at("2023-02-05", "07:00"))
    .visit("mysore", at("2023-02-05", "10:00"), at("2023-02-05", "15:00"), MYSURU) // ~131 km
    .home(at("2023-02-05", "19:00"), at("2023-02-06", "08:00"));

  it("the away distance decides what counts", () => {
    expect(tl().atlas().trips).toHaveLength(1);
    expect(tl().atlas({ lens: { awayKm: 25 } }).trips).toHaveLength(2);
    expect(tl().atlas({ lens: { awayKm: 200 } }).trips).toHaveLength(0);
  });

  it("family homes count as base only when the user says so", () => {
    const t = new Timeline().home(at("2023-01-01"), at("2023-01-02", "08:00"));
    const weekends = ["2023-02-04", "2023-03-04", "2023-04-08", "2023-05-06", "2023-06-03"];
    let last = "2023-01-02T08:00:00.000+05:30";
    for (const d of weekends) {
      t.home(last, at(d, "08:00"));
      t.visit("parents", at(d, "11:00"), `${d.slice(0, 8)}${String(Number(d.slice(8)) + 1).padStart(2, "0")}T16:00:00.000+05:30`, MYSURU);
      last = `${d.slice(0, 8)}${String(Number(d.slice(8)) + 1).padStart(2, "0")}T19:00:00.000+05:30`;
    }
    t.home(last, at("2023-07-01"));
    const atlas = t.atlas();
    expect(atlas.places.get("parents").kind).toBe("family");
    expect(atlas.trips).toHaveLength(5);
    atlas.update({ lens: { familyIsBase: true } });
    expect(atlas.trips).toHaveLength(0);
  });
});

describe("places and labels", () => {
  const base = () => {
    const tl = new Timeline();
    for (let w = 0; w < 6; w++) {
      const d = new Date(Date.parse("2023-01-02T00:00:00Z") + w * 7 * 86400000).toISOString().slice(0, 10);
      tl.home(at(d), at(d, "08:00"));
      tl.visit("cafe", at(d, "09:00"), at(d, "10:00"), [12.9708, 77.641]);
      tl.home(at(d, "10:30"), at(d, "23:00"));
    }
    tl.visit("fort", at("2023-03-01", "10:00"), at("2023-03-01", "13:00"), JAIPUR);
    return tl;
  };

  it("works out kinds from patterns", () => {
    const atlas = base().atlas();
    expect(atlas.places.get("home")).toMatchObject({ kind: "home", kindSource: "timeline" });
    expect(atlas.places.get("cafe")).toMatchObject({ kind: "everyday", kindSource: "pattern" });
    expect(atlas.places.get("fort")).toMatchObject({ kind: "explored", city: "Jaipur", state: "Rajasthan" });
  });

  it("routine Google types are everyday even when visited once", () => {
    const atlas = base().atlas({ google: { fort: { name: "Fuel stop", types: ["gas_station"] } } });
    expect(atlas.places.get("fort").kind).toBe("everyday");
  });

  it("names come from you, then Google, then the Timeline, then OpenStreetMap", () => {
    const tl = base();
    tl.segments.at(-1).visit.topCandidate.name = "From timeline";
    const osm = { fort: { name: "From OSM", tags: { historic: "fort" } } };
    const google = { fort: { name: "From Google", types: ["historical_landmark"] } };
    const pick = (o) => tl.atlas(o).places.get("fort");
    expect(pick({ osm })).toMatchObject({ name: "From timeline", nameSource: "timeline", category: "fort" });
    expect(pick({ osm, google })).toMatchObject({ name: "From Google", nameSource: "google", category: "historical_landmark" });
    expect(pick({ osm, google, labels: { fort: { name: "Amber" } } })).toMatchObject({ name: "Amber", nameSource: "you" });
    const noTimeline = base();
    expect(noTimeline.atlas({ osm }).places.get("fort")).toMatchObject({ name: "From OSM", nameSource: "osm" });
    expect(noTimeline.atlas().placeRow(noTimeline.atlas().places.get("fort")).name).toBe("Place in Jaipur");
  });

  it("your labels win and survive re-resolution", () => {
    const atlas = base().atlas({ labels: { cafe: { kind: "explored", theme: "food" }, fort: { hidden: true, city: "Amer" } } });
    expect(atlas.places.get("cafe")).toMatchObject({ kind: "explored", kindSource: "you", theme: "food" });
    expect(atlas.places.get("fort")).toMatchObject({ hidden: true, city: "Amer" });
    expect(atlas.placesList().places.map((p) => p.place_id)).not.toContain("fort");
    expect(atlas.placesList({ includeHidden: true }).places.map((p) => p.place_id)).toContain("fort");
  });

  it("city aliases fix a gazetteer quirk everywhere at once", () => {
    const atlas = base().atlas({ cityAliases: { Jaipur: "Pink City" } });
    expect(atlas.places.get("fort").city).toBe("Pink City");
  });

  it("a stray HOME tag on a hotel doesn't move home when home is well established", () => {
    const tl = base();
    tl.visit("hotel", at("2023-03-02", "20:00"), at("2023-03-03", "08:00"), JAIPUR, "INFERRED_HOME");
    expect(tl.atlas().places.get("hotel").kind).not.toBe("home");
  });
});

describe("trip edits", () => {
  it("renames and hides by stable id", () => {
    const tl = new Timeline()
      .home(at("2023-02-01"), at("2023-02-04", "07:00"))
      .visit("mysore", at("2023-02-04", "10:00"), at("2023-02-04", "15:00"), MYSURU)
      .home(at("2023-02-04", "19:00"), at("2023-02-06", "08:00"));
    const atlas = tl.atlas({ tripEdits: { 202302040700: { title: "Palace day" } } });
    expect(atlas.trips[0]).toMatchObject({ title: "Palace day", detected_title: "Mysuru" });
    atlas.update({ tripEdits: { 202302040700: { hidden: true } } });
    expect(atlas.trips).toHaveLength(0);
    expect(atlas.journeys({ includeHidden: true }).journeys[0].hidden).toBe(true);
    expect(atlas.overview().totals.journeys).toBe(0);
  });
});

describe("home location", () => {
  it("is anchored where the HOME visits are", () => {
    const atlas = new Timeline().home(at("2023-02-01"), at("2023-02-01", "07:00")).atlas();
    expect(atlas.homes()[0]).toMatchObject({ place_id: "home", latitude: HOME[0] });
  });
});
