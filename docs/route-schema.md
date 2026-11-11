# Crux route file format (schema version 1)

A route is a single JSON document, conventionally saved as `*.crux.json`. The
authoritative definition is the Zod schema in `src/model/schema.ts`. Import goes
through `parseRouteJson()` in `src/model/serialize.ts`, which checks the
structure first, then the meaning, and returns readable errors.

A complete example is in `fixtures/minimal-route.crux.json`.

## Versioning

| Field           | Value          | Notes |
|-----------------|----------------|-------|
| `format`        | `"crux.route"` | Identifies the file type. Anything else is rejected. |
| `schemaVersion` | `1`            | Integer. Older versions are upgraded by the step functions in `MIGRATIONS` (`serialize.ts`). Newer versions are rejected with an "update Crux" message rather than being half-loaded. |

Rules for changing the schema:

- **Additive, optional fields** that have a `.default()` in Zod do not need a version bump.
- **Renames, removals, or changes in meaning** do need one. Bump `ROUTE_SCHEMA_VERSION`, add `MIGRATIONS[n] = (raw) => …` that converts the vN object to v(N+1), and add a fixture plus a test for the old version.

## Coordinate systems

```
 normalized (stored)        image px              screen px (editor only)
 (0,0)──────► u            (0,0)──────► x          ViewTransform:
   │                         │                      screen = image·scale + offset
   ▼ v       (1,1)           ▼ y      (W,H)

 wall-local (meters)                   world (three.js preview)
   ▲ y (up the wall surface)            y up, +z toward the viewer,
   │                                    x centred on the wall,
   └──► x      z = out of the wall      wall pivots about its base line
 (0,0) = bottom-left of the photo
```

- **Normalized `(u, v)`** is what gets stored. `u = x_px / image.width` and `v = y_px / image.height`, both in [0,1] with the origin at the top-left. Because coordinates are resolution-independent, downscaling the photo, resizing the window, zooming, or exporting without the photo never moves a hold.
- **Hold `radius`** is a fraction of the **image width**, so the radius in pixels is `radius · image.width`.
- **Screen** coordinates exist only in the editor. The view state is `{ zoom, center }`, where zoom is relative to "fit" and center is in image pixels, so a window resize keeps the same part of the photo centred.
- **Wall-local meters** use `x = u · W · mpp` and `y = (1 − v) · H · mpp`, with `z` as protrusion from the wall surface. `mpp` is `wall.metersPerPixel`. See `normalizedToWall()`.
- **World** coordinates come from `wallToWorld(p, angleDeg, wallWidth, baseY)`, which is a rotation about the x-axis by the wall angle followed by a lift of `baseY`. The test suite checks this against three.js's own `Euler` rotation.

### Assumptions (these are not measurements)

1. The photo is roughly frontal to a **single planar** wall panel. Perspective and lens distortion are ignored.
2. The bottom edge of the photo is the wall's pivot (base) line.
3. Scale is uniform across the photo. Until the user calibrates it (`scaleSource: "default"`), the photo is assumed to span 4.5 m of wall height.
4. `depthCm`, `facingDeg`, `difficulty`, and `type` are **user estimates**. A single RGB photo cannot reliably provide them.

## `Route`

| Field | Type | Description |
|---|---|---|
| `format` | `"crux.route"` | |
| `schemaVersion` | `1` | |
| `id` | string | Stable route id. |
| `name` | string ≤ 120 | |
| `grade` | string ≤ 20 | Free text (`"V4"`, `"6B+"`). Defaults to `""`. |
| `notes` | string ≤ 5000 | Defaults to `""`. |
| `createdAt`, `updatedAt` | ISO-8601 string | `updatedAt` is stamped on export. |
| `image.name` | string | Original file name. |
| `image.width`, `image.height` | positive int | Pixel size that the normalized coordinates refer to. |
| `image.dataUrl` | `data:image/…` or `null` | Embedded photo (JPEG, re-encoded with EXIF/GPS stripped). `null` means it was exported without the photo, and the user can re-attach it. |
| `wall.angleDeg` | number in [−45, 90] | 0 = vertical, + = overhang, − = slab, 90 = roof. |
| `wall.metersPerPixel` | number > 0 | Real-world scale. |
| `wall.scaleSource` | `"default" \| "wall-width" \| "reference-hold"` | How the scale was obtained. |
| `footRule` | `"open" \| "route-only"` | Whether any wall hold can be used for feet, or only route holds ("feet follow hands"). |
| `holds` | `Hold[]` | Every annotated hold, whether or not it is on the route. |
| `startHoldIds` | string[] | Start holds. Each must reference an existing hold with `inRoute: true`. |
| `finishHoldIds` | string[] | Finish holds, with the same rules. |

## `Hold`

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique within the route. |
| `label` | string ≤ 40 | Display label. Auto-numbered on creation. |
| `u`, `v` | number in [0,1] | Normalized centre. |
| `radius` | number in (0, 0.5] | Fraction of image width. |
| `type` | `jug \| crimp \| edge \| sloper \| pinch \| pocket \| undercling \| sidepull \| volume \| foot-chip \| unknown` | |
| `facingDeg` | number in [0,360) or `null` | Direction the usable surface faces, measured clockwise from up: 0 is a down-pull, 90 faces right, 180 is an undercling, 270 faces left. `null` means unknown. |
| `inRoute` | boolean | Whether the hold is part of this problem. Other wall holds can be annotated as `false`. |
| `allowHand`, `allowFoot` | boolean | Which limbs the planner may place on the hold. |
| `difficulty` | int 1–5 or `null` | Subjective grip quality, from 1 (good) to 5 (poor). |
| `depthCm` | number in [0,200] or `null` | Estimated protrusion. The 3D preview falls back to `0.45 · radius` when this is `null`. |
| `confidence` | number in [0,1] | Confidence in the annotation. Manual annotations default to 1. |
| `source` | `manual \| sample \| model` | `model` is reserved for future computer-vision suggestions. |
| `note` | string ≤ 500 | Defaults to `""`. |

## Semantic checks (`validateRoute`)

- **Errors** block import: duplicate hold ids, start/finish ids that point at missing holds, duplicate entries in the start/finish lists, and start/finish holds that are not `inRoute`.
- **Warnings** appear in the Checks panel: no start or finish, more than 2 hand-start holds, more than 2 finish holds, a finish hold that doesn't allow hands, a hold allowing neither hands nor feet, a hold that is both start and finish, and "feet follow hands" with no route footholds.
- **Info** notes: the scale is uncalibrated, or the route has no holds yet.
