# Planner, avatar, detect, library (implemented)

The pieces sketched here originally as M2/M3 now live in the app:

| Piece | Location |
|---|---|
| Climber profile | `src/climber/profile.ts` (localStorage `crux:climber:v1`) |
| Grip / statics | `src/planner/grip.ts`, `src/planner/body.ts` |
| Beam-search beta | `src/planner/search.ts` → `planBeta(route, profile)` |
| Explanations | `src/planner/explain.ts` (templated; never mutates the plan) |
| Avatar IK | `src/avatar/skeleton.ts` + `AvatarOverlay` on the 2D canvas |
| Playback UI | `src/components/BetaPanel.tsx`, `src/state/usePlayback.ts` |
| Auto-detect | `src/detect/*` + `DetectPanel` |
| Climb library | `src/lib/library.ts` (IndexedDB `crux`) |

## Data flow

```
 Route JSON (v1) ──► buildContext ──► Planner (beam search) ──► Beta[] ──► skeletonAt ──► AvatarOverlay
                         ▲                                      │
                  ClimberProfile                               ▼
                                         explain.ts (templated text; never changes Beta)
```

## Still open

- 3D skeleton on the R3F wall (2D overlay works today).
- Optional Web Worker for `planBeta` on large routes.
- Trained hold detector (current path is classical Lab/HSV + morphology).
- LLM rewrite of move explanations on top of the same Beta features.
