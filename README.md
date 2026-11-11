# Crux: bouldering route editor (M0–M1)

Crux turns a wall photo into an editable, versioned route file. You mark the
holds, choose start and finish, set the wall angle and scale, save and load JSON,
and inspect the holds on an approximate 3D wall. Beta planning and avatar
playback are next. See `climbing-beta-overview.md` and
`docs/architecture-next.md`.

> The 3D view is an **approximation**. It assumes a planar wall seen front-on.
> Hold depth is a user estimate, and nothing is physically simulated.

## Quick start

Requires Node 20 or newer (tested on Node 24).

```bash
npm install
npm run dev          # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm test` | Vitest unit and component tests (jsdom) |
| `npm run lint` | ESLint (typescript-eslint, react-hooks) |
| `npm run typecheck` | `tsc -b` |
| `npm run build` | Type-check, then production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run check` | typecheck + lint + test + build |

## Using it

1. The app opens on the **Tangerine Ladder** sample, which runs entirely offline. The other sample is under **Load sample…**.
2. **Upload photo**, or drop an image anywhere. Photos are downscaled to 2400 px on the long edge and re-encoded, which applies EXIF rotation and strips GPS metadata. If the current route already has holds, you choose between starting a new route and keeping the holds (useful for re-attaching a photo).
3. **Annotating holds:**
   - Press **A**, or use the **+ Add hold** button, then click to place a hold. You can drag immediately to adjust it.
   - With the **Select** tool, double-click to add a hold.
   - Drag a hold to move it. Drag its white handle to resize it.
   - Drag the background to pan. Use the wheel or a pinch to zoom, and press **0** to fit the photo.
4. **Roles:** press **S**, **F**, or **R** to toggle start, finish, or in-route membership. You can also use the inspector buttons or the S/F buttons in the hold list.
5. **Metadata:** set type, facing direction, hands/feet allowance, difficulty, depth, confidence, and notes in the inspector.
6. **Wall & scale:** set the wall angle with the slider, the number field, or the presets (slab through roof). Calibrate scale from the visible wall width, or from a selected hold whose diameter you know.
7. **Export JSON:** export with the photo (one portable file) or without it (a small file; re-attach the photo after import). **Import JSON** validates the file, and if it's rejected the current route is left untouched.
8. **2D + 3D / 3D** shows the same holds on a tilted planar wall, textured with your photo, next to a 1.75 m scale figure. Clicking a hold in 3D selects it.

Undo and redo use ⌘Z / ⇧⌘Z. Drags, slider scrubs, and typing in one field each count as a single undo step. The working draft autosaves to `localStorage`; if the photo is too big for local storage, the draft is saved without it, and the header says so. Press **?** for all shortcuts.

## Project layout

```
src/
  model/          pure, framework-free, fully unit-tested
    schema.ts       Zod schema + types for Route/Hold (versioned)
    coords.ts       normalized ↔ image ↔ screen ↔ wall-local ↔ world transforms
    route.ts        immutable hold/route operations + semantic validation
    serialize.ts    export/import, version migration hook, readable errors
    history.ts      undo/redo with edit coalescing
  samples/        curated sample routes (procedural SVG "photos", no binaries)
  state/          useRouteEditor: history + autosave
  components/     EditorCanvas (SVG overlay), inspector panels, WallPreview3D (R3F, lazy-loaded)
  lib/            image ingest, downloads
fixtures/         hand-written route files used by tests
docs/             route-schema.md, architecture-next.md
```

Design choices:

- **SVG overlay instead of Konva or canvas.** There are dozens to a few hundred holds, and SVG gives per-hold DOM events, crisp strokes at any zoom, and easy testing in jsdom with no extra dependency. Hold geometry is computed by the same pure `coords.ts` functions the tests cover.
- **No backend yet.** Routes are portable JSON files plus a local draft. A FastAPI planner can be added behind the same JSON contract once M2 starts (see `docs/architecture-next.md`).
- **The 3D preview is code-split**, so it only loads when you open the 3D view.

The file format and coordinate systems are documented in **`docs/route-schema.md`**.

## Known limitations

- Photos are treated as frontal and planar, with no perspective correction. Holds marked on an angled photo will be slightly off in wall-local meters.
- There is no multi-panel or volume geometry. The 3D preview lifts steep walls (35° and up) onto a kicker panel purely for visibility.
- Pinch-zoom is supported through trackpad gestures. Two-finger touch-screen pinch is not; use the +/− buttons instead.
- `npm audit` reports a moderate advisory in `minimatch` that comes in through the ESLint toolchain. It is development-only and does not ship in the app bundle.
