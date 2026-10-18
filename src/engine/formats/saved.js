// Places you saved or labelled in Google Maps, from Google Takeout:
//   Maps (your places)/Saved Places.json   starred and listed places
//   Maps/My labeled places/Labeled places.json   your own labels ("Grandma's place")
// Both are GeoJSON. They are your own data, so their names can be kept, unlike
// answers from Google's Places API.

const num = (x) => (x == null || x === "" ? null : Number(x));

/** Is this parsed JSON a Takeout saved/labelled places file? */
export function isSavedPlaces(root) {
  return root?.type === "FeatureCollection" && Array.isArray(root.features)
    && root.features.some((f) => f?.properties && (f.properties.google_maps_url || f.properties.location
      || f.properties.Title || f.properties.name || f.properties.Location));
}

/** One saved place: { name, lat, lng, address, source } or null. */
export function readSavedFeature(f, source = "saved") {
  const p = f?.properties || {};
  const loc = p.location || p.Location || {};
  const geo = loc["Geo Coordinates"] || {};
  let [lng, lat] = Array.isArray(f?.geometry?.coordinates) ? f.geometry.coordinates.map(Number) : [null, null];
  if (!lat && !lng) [lat, lng] = [num(geo.Latitude) ?? num(loc.latitude), num(geo.Longitude) ?? num(loc.longitude)];
  // Entries saved without a location come through as 0,0.
  if (lat == null || lng == null || (lat === 0 && lng === 0) || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  const name = (loc.name || loc["Business Name"] || p.name || p.Title || "").trim();
  if (!name || /^(home|work)$/i.test(name) || /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(name)) return null;
  return { name, lat, lng, address: loc.address || loc.Address || p.address || null, source };
}

export function readSavedPlaces(root, sink) {
  // Labelled places carry only "name" and "address"; saved places have a Maps URL.
  const labelled = root.features.every((f) => f?.properties && !f.properties.google_maps_url && !f.properties.location);
  for (const f of root.features) {
    const s = readSavedFeature(f, labelled ? "labelled" : "saved");
    if (s) sink.savedPlace(s);
  }
  return "saved";
}
