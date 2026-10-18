# Configuration

Everything is set inside the app, in **Settings**, and applies at once. There are no
config files to edit unless you [run your own copy](setup.md#run-your-own-copy).

## What counts as a trip

Settings → *What counts as a trip* (also step 3 of the setup screen).

| Setting | Default | Meaning |
|---|---|---|
| Distance from home | 50 km | 10, 25, 50, 100, 200 or 500 km. 10 km catches day trips. |
| Work counts as home base | on | A long commute isn't a trip. |
| Family homes count as home base | off | Turn on so visiting family isn't a trip. |
| Shortest trip | 3 hours | 1, 3, 6 or 12 hours away. |
| Join layovers | on | Two legs split by a short stop at home (up to 12 hours, such as an airport layover) are one trip. |

Fixed rules: a trip runs from leaving home to getting back, so the drive or the airport
is part of it; more than 72 hours without data ends a trip; anything over 45 days away is
treated as living elsewhere, not a trip. Trips are measured from the home you had at the
time.

Any trip can be **renamed** or marked **Not a trip**. Both stick across re-imports and
rule changes, keyed by the trip's departure time.

## Place kinds

Every place has one kind. Your choice always wins; until then Atlas decides:

| Kind | How Atlas decides |
|---|---|
| 🏠 Home | Where you sleep: each month, the area (about 1 km) holding most of your nights. Two or more months in one area make a home, so homes change when you move. Google's HOME label only breaks ties, or stands in for very short exports. |
| 💼 Work | A place (or a cluster within 500 m) with 30+ weekdays of long daytime stays. |
| 🏡 Family home | Somewhere you stay the night often: 4+ nights across 3+ months, away from your home. |
| 🔁 Everyday | Routine places (shops, gyms, schools...) or places near home visited in 4+ different weeks. |
| 🧭 Explored | Everything else: places on trips, or visited now and then. |

To keep lists short:

- **One-off stops** (a single visit under 30 minutes that nothing has named: fuel, tolls,
  a quick break) are folded away and left out of counts.
- **Place IDs within 100 m** that can't be told apart (same kind, same name, or both
  unnamed) are merged into one place.

## Where names come from

The first source with an answer wins, and each place shows its source.

| # | Source | Notes |
|---|---|---|
| 1 | **You** | Anything you set, including a quick rename from an itinerary stop or a map pin |
| 2 | **Your Google Maps saved and labelled places** | From Google Takeout; matched within 50 m. Labels ("Grandma's place") beat starred business names |
| 3 | **Google Places** | Only with your own key (see [setup](setup.md#3-better-place-names-optional)) |
| 4 | **Timeline** | Names in old Takeout location history |
| 5 | **OpenStreetMap** | Automatic after each import. A name only when something named is right there: shops within ~30 m, places of worship and parks ~60 m, sights ~120 m. Otherwise a label: "Near Hawa Mahal", or the neighbourhood and city |
| 6 | **Visit pattern** | When nothing else knows, the kind comes from your visits |

City, state and country always come from an offline gazetteer (GeoNames cities with
5,000+ people), so they work without any lookups. If it calls a whole area by a district
name, rename that city once in **Settings → City names** and every place follows.

## Settings

| Section | Setting | Default |
|---|---|---|
| Names | Look up OpenStreetMap names automatically | on |
| Names | Google Places key | none |
| City names | Renamed cities (aliases) | none |
| This device | Keep my data (asks the browser not to clear it) | off |
| Your data | Back up, Restore, Delete everything | — |

## What Atlas stores

All in this browser's IndexedDB, database `atlas`, one store:

| Key | Contents |
|---|---|
| `dataset` | Your visits, journeys and route points, merged across imports, plus an import log |
| `labels` | Your edits to places: name, kind, category, city, note, hidden |
| `tripEdits` | Renamed trips and "Not a trip", keyed by departure time (`YYYYMMDDHHMM`) |
| `saved` | Saved and labelled places from Google Takeout |
| `osm` | OpenStreetMap answers, by place ID |
| `google` | Google Places answers, by place ID (only with a key) |
| `settings` | The settings above, including the Google key |

A backup (`.atlas` file) holds all of these except the Google key.

## Network

Atlas works offline once loaded. It goes online only for:

| What | Server | What it sees | Where to change it |
|---|---|---|---|
| Map backgrounds | `tile.openstreetmap.org` | The map areas you view | `TILE_URL` in `src/ui/map.js` |
| OpenStreetMap names | `overpass-api.de` | Coordinates of unnamed places, 20 at a time | `OVERPASS_URL` in `src/engine/osm.js`; turn off in Settings → Names |
| Google names (optional) | `maps.googleapis.com` | Place IDs, with your key | Remove the key in Settings → Names |

If you host Atlas for many people, use your own tile and Overpass servers, as both
OpenStreetMap services ask heavy users to.
