// The whole engine on the fictional demo timeline: what the app will show.

import { describe, expect, it } from "vitest";
import { androidExport, buildSegments, placeDetails, TRIPS } from "../../src/demo/generate.js";
import { Atlas } from "../../src/engine/atlas.js";
import { readExport } from "../../src/engine/formats/read.js";
import { Batch, Dataset } from "../../src/engine/ingest.js";
import { getGeocoder } from "./helpers.js";

const batch = new Batch();
await readExport(new Blob([JSON.stringify(androidExport(buildSegments()))]), batch, { offset: 330 });
const ds = new Dataset();
ds.merge(batch);
const atlas = () => new Atlas({ dataset: ds, geocoder: getGeocoder(), google: placeDetails() });

describe("demo timeline", () => {
  it("finds every planted trip plus the family weekends", () => {
    const a = atlas();
    const starts = a.trips.map((t) => t.start_date);
    for (const t of TRIPS) expect(starts).toContain(t.start);
    expect(a.trips).toHaveLength(TRIPS.length + 5);
    a.update({ lens: { familyIsBase: true } });
    expect(a.trips.map((t) => t.start_date)).toEqual(TRIPS.map((t) => t.start));
  });

  it("labels places by kind", () => {
    const kinds = atlas().overview().kinds;
    expect(kinds).toMatchObject({ home: 1, work: 1, family: 1 });
    expect(kinds.everyday).toBeGreaterThanOrEqual(6);
    expect(kinds.explored).toBeGreaterThan(70);
  });

  it("builds the overview in the API's shape", () => {
    const o = atlas().overview();
    expect(o.has_journeys).toBe(true);
    expect(o.totals).toMatchObject({ journeys: 20, countries: 2 });
    expect(o.totals.farthest.title).toBe("Singapore");
    expect(o.years.map((y) => y.year)).toEqual(["2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"]);
    expect(o.transport.map((t) => t.mode)).toEqual(expect.arrayContaining(["flight", "car", "train"]));
    expect(o.journeys[0].start_date > o.journeys.at(-1).start_date).toBe(true);
    expect(o.journeys[0].transport).toBeTypeOf("object");
  });

  it("details a trip with its track, stops and legs", () => {
    const a = atlas();
    const jaipur = a.trips.find((t) => t.start_date === "2019-12-20");
    const d = a.journey(jaipur.id);
    expect(d.title).toBe("Udaipur, Jaipur & Chittorgarh");
    expect(d.home_country).toBe("India");
    expect(d.path.length).toBeGreaterThan(1);
    expect(d.visits.find((v) => v.name === "Amber Fort")).toMatchObject({ theme: "landmark", kind: "explored", routine: false });
    expect(d.activities.some((x) => x.mode === "flight")).toBe(true);
    expect(d.prev && d.next).toBeTruthy();
  });

  it("places carry where their labels came from", () => {
    const a = atlas();
    const rows = a.placesList().places;
    expect(rows.find((p) => p.name === "Taj Mahal")).toMatchObject({ name_source: "google", kind: "explored", state: "Uttar Pradesh", trip_visits: 1 });
    const parents = rows.find((p) => p.kind === "family");
    expect(parents).toMatchObject({ named: false, name: "Place in Mysuru", kind_source: "pattern" });
    expect(a.review().places.map((p) => p.place_id)).toContain(parents.place_id);
    const detail = a.place(parents.place_id);
    expect(detail.visits.length).toBe(5);
    expect(detail.visits[0].journey_id).toBeTruthy();
  });

  it("summarises everyday life", () => {
    const e = atlas().everyday();
    expect(e.has_home && e.has_work).toBe(true);
    expect(e.commute.legs).toBeGreaterThan(3000);
    expect(e.commute.avg_minutes).toBeGreaterThan(20);
    expect(e.commute.avg_depart_hour).toBeGreaterThan(7.5);
    expect(e.regular.map((r) => r.name)).toEqual(expect.arrayContaining(["Third Wave Coffee", "Toit"]));
    expect(e.months.length).toBeGreaterThan(80);
  });

  it("remembers this day in earlier years", () => {
    const m = atlas().memories("2026-12-22");
    expect(m.journeys.map((j) => j.title)).toContain("Udaipur, Jaipur & Chittorgarh");
    expect(m.visits.every((v) => v.journey_id)).toBe(true);
  });
});
