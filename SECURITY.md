# Security

## Reporting a problem

Please report security problems privately: on GitHub, open the repository's
**Security** tab → **Report a vulnerability**. Please
don't open a public issue for a security problem.

## How Atlas keeps your data private

- Atlas is static files. There is no server-side code, no account and no database
  outside your browser.
- Your Timeline is read by a Web Worker in the page and stored in that browser's
  IndexedDB. It is never uploaded.
- Network requests are limited to map tiles (OpenStreetMap), OpenStreetMap names
  (Overpass, coordinates of unnamed places, can be turned off) and, only if you add your
  own key, Google Places (place IDs). See [docs/how-it-works.md](docs/how-it-works.md#privacy).
- A Google key you add stays in IndexedDB on the device and is left out of backups.
- No analytics, tracking or cookies.

Reports we especially want: any way for a page, file or link to read another person's
Atlas data, any request that sends history beyond what's listed above, and any way an
imported file can run script in the page.

## Supported versions

The latest release on `main` (and the `v1` branch). Fixes are not backported.
