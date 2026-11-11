# Crux: climbing beta from a wall photo

Crux turns a wall photo into an editable, versioned route, then finds a
realistic beta for **your** body and strength and plays it back as a stick-figure
avatar on the photo.

> The physics and 3D view are **approximations**. The wall is treated as planar
> and front-on; grip capacities are coarse priors, not lab measurements.

## Quick start

Requires Node 20 or newer.

```bash
npm install
npm run dev          # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm test` | Vitest unit and component tests (jsdom) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc -b` |
| `npm run build` | Production build into `dist/` |
| `npm run check` | typecheck + lint + test + build |

## Using it

1. Open a **sample** (toolbar) or **Climbs** for saved routes / samples.
2. **Upload photo** (or drop an image). Photos are downscaled to 2400 px and re-encoded (EXIF rotation applied, GPS stripped).
3. **Auto-detect** (sidebar): pick the route color (or eyedrop from the photo), run detection, then adjust holds. Set a **floor line** (cyan dashed line) so heights are measured from the mat, not the photo bottom.
4. Annotate / edit holds (A to add, drag to move, white handle to resize). Roles: **S** / **F** / **R**.
5. **Climber**: default is 5′11″, ape index 0, V4–V5 athletic profile. Edit height, wingspan, weight, and strength sliders.
6. **Find beta ▶**: beam-search planner with grip physics (no one-hand crimp hangs on overhangs without feet). Play / step / scrub the sequence; the avatar overlays the photo.
7. Routes **autosave** to IndexedDB (Climbs) and a draft to `localStorage`. Export/import `.crux.json` as before.

Press **?** for shortcuts.

## Project layout

```
src/
  model/       schema, coords (incl. floorV / wallFrame), route ops, serialize, history
  climber/     body profile + anthropometrics
  planner/     grip model, pose solver, beam-search beta planner
  avatar/      two-bone IK skeleton + playback interpolation
  detect/      wall/mat/hold segmentation + type heuristics
  lib/         image ingest, climb library (IndexedDB)
  components/  editor, beta player, detect panel, climber modal, 3D preview
  samples/     offline sample routes
docs/          route-schema.md, architecture-next.md
```

## Known limitations

- Photos are treated as frontal and planar; no perspective correction.
- Auto-detect is classical CV (color + morphology), not a trained detector — expect to nudge holds.
- Avatar is 2D on the photo for now; the 3D view shows the wall without the skeleton yet.
- Grip ratings are priors tuned so sample routes and unit tests stay realistic for the default climber.
