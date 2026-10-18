# Atlas brand

**Mark: "Round trip".** A route leaves the home dot, reaches an amber destination and
comes back. It says what Atlas does: trips start and end at home.

| File | Use |
|---|---|
| `atlas.svg`, `icon-512.png` | App icon, navy rounded square |
| `atlas-mark.svg` | The mark alone, for dark surfaces (the app header) |
| `social-preview.png` | GitHub social preview, 1280×640 |

All icon sizes are drawn by `npm run icons` (`scripts/build-icons.mjs`); the social
preview and the how-it-works images by `node scripts/build-docs-images.mjs`.

## Palette

| Name | Hex | Where |
|---|---|---|
| Navy | `#13202e` | Icon background, app header |
| Teal | `#19c2ad` | The route in the mark |
| Amber | `#f2b33d` | The destination dot, highlights |
| Brand (light) | `#0f9d8f` | Charts and buttons on light backgrounds |
| Brand (dark) | `#19a596` | Charts and buttons in dark mode |
| Background | `#f4f6f8` / `#0e1419` | Page, light / dark |

## Type

The system font stack (`system-ui`, `-apple-system`, `Segoe UI`, `Roboto`), so no font is downloaded.
