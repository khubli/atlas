# Contributing to Atlas

Thanks for helping. Bug reports with a clear "what I did, what I expected, what
happened" are as useful as code.

**Never attach your real Timeline export** to an issue or a pull request: it is your
location history. Describe the shape instead (which phone, which keys, a few
hand-written lines with made-up coordinates), or reproduce it with the demo traveller.

## Run it

Requires Node 22.12+.

```bash
npm install
npm run dev          # http://localhost:5173; writes the demo data first
npm test             # unit tests (Vitest), about 3 seconds
npm run test:e2e     # end-to-end tests (Playwright) against the production build
npm run build        # dist/
```

The end-to-end tests run the real production build with its service worker, on a
desktop and a phone viewport. They never reach the network: map tiles are a blank
image, OpenStreetMap and Google answer from stubs, and any console error fails the test.
If Playwright's own browser download isn't available, point `PW_CHROMIUM` at a local
Chromium.

| Command | What it does |
|---|---|
| `npm run demo-data` | Writes the fictional demo export to `public/demo/` |
| `npm run geodata` | Rebuilds `public/geo/places.json` from GeoNames `cities5000` |
| `npm run icons` | Redraws the logo and every icon size in `public/icons/` |
| `node scripts/build-docs-images.mjs` | Redraws the how-it-works images and the social preview |
| `node scripts/screenshots.mjs [url]` | Retakes the README screenshots from the demo (needs `vite preview` running) |
| `node scripts/make-fixtures.mjs DIR [--scale]` | Writes the e2e test exports (Android, iPhone, Takeout, saved places, ~100 MB) |
| `ATLAS_SCALE=1 npm run test:e2e -- scale` | Imports a ~100 MB export |

## Where things live

| Path | What |
|---|---|
| `src/engine/` | Everything that understands timelines: formats, merging, homes, labels, trips, everyday. Plain JavaScript with no browser APIs, so it's tested directly |
| `src/worker/` | The Web Worker that runs the engine and owns storage |
| `src/ui/views/` | One file per screen |
| `src/ui/` | Shared UI: charts, maps, rename, naming jobs, formatting |
| `tests/unit/` | Engine tests with hand-written timelines (`helpers.js` has a `Timeline` builder) |
| `tests/e2e/` | Playwright specs and shared fixtures |

[docs/how-it-works.md](docs/how-it-works.md) explains the pipeline.

## Adding support for a new export shape

The most common change. Google changes the export from time to time, and it differs by
phone and language.

1. Add a reader in `src/engine/formats/` that turns the new shape into calls on the
   sink (`visit`, `move`, `point`), like `segments.js` does.
2. Recognise the shape in `dispatchRoot` in `src/engine/formats/read.js` and give it a
   label in `FORMAT_LABELS`.
3. Add a unit test in `tests/unit/import.test.js` with a few made-up records, and, if
   the shape needs streaming, a fixture in `scripts/make-fixtures.mjs` with an e2e case
   in `tests/e2e/import.spec.js`.

## Pull requests

- Keep each one to one change, with tests for behaviour changes. `npm test` and
  `npm run test:e2e` must pass; CI runs both.
- Use the demo traveller or made-up data in tests, fixtures and screenshots. Real
  coordinates of a real person's home are personal data.
- Keep everything on the device. A change that sends history anywhere new needs a very
  good reason, a setting to turn it off, and a line in the Privacy section of
  `docs/how-it-works.md`.
- Write UI text in plain words: say what happened and what to do next.

Every pull request is reviewed before merging.
