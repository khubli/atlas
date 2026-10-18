# Changelog

## 1.0.0

First public release.

- Reads the Google Timeline export from Android and iPhone, and old Google Takeout
  location history (zip or monthly files), entirely in the browser; files over 24 MB
  are streamed. Newer exports merge with earlier ones.
- Finds homes over time from where you sleep, and work from long weekdays.
- Finds trips by rules you set (distance, shortest trip, work and family homes as home
  base, joined layovers), with a day-by-day itinerary, route map, distances and travel
  modes. Trips can be renamed or dismissed, and edits survive re-imports.
- Everyday page: commutes, time at home, work and regular places.
- Places with a kind (home, work, family home, everyday, explored), a name, a city and
  the source of each. Names from your edits, your Google Maps saved and labelled places,
  Google Places (optional, your key), Timeline and OpenStreetMap; offline GeoNames for
  city, state and country. One-off stops folded away; nearby duplicates merged.
- Overview, Trips, Everyday, Map and Places screens, light and dark, phone and desktop.
- Installable PWA: works offline, accepts the export from the phone's share menu.
- Backup and restore to one file; delete everything in one tap.
- Built-in demo traveller.
