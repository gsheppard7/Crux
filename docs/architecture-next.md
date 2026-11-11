# Next: planner (M2) and avatar playback (M3)

This is a proposal; none of it is implemented yet. Both components consume the
v1 route schema without changing it, and add their own data on top.

```
 Route JSON (v1) ──► PlannerInput ──► planner (deterministic) ──► Beta[] ──► IK/playback (3D)
                         ▲                                           │
                  ClimberProfile                                    ▼
                                         explanation layer (templated text now, LLM later)
                                         reads Beta + move features; never changes them
```

## 1. Planner input, derived from the route

`toPlannerInput(route, profile)` would be a pure function in `src/model/`:

- **Usable holds.** For hands, take `inRoute && allowHand`. For feet, take `allowFoot` and also require `inRoute` when `footRule === "route-only"`.
- **Positions.** Convert each hold to wall-local meters with `normalizedToWall()`. Because the wall is planar, the planner works in 2D `(x, y)`, and `wall.angleDeg` only changes costs: steeper walls make it more expensive to move feet and to hang without them.
- **Hold features.** Carry over `type`, `facingDeg`, `difficulty`, `confidence`, and `radius`. Unknown values get conservative defaults, and the move that relied on them gets flagged in its caveats.
- **ClimberProfile.** `{ heightM, wingspanM?, style: 'static'|'balanced'|'dynamic' }`. Limb lengths come from standard anthropometric ratios of height (for example, shoulder-to-fingertip ≈ 0.38 × height and hip-to-floor ≈ 0.52 × height), and wingspan overrides arm length if given.

## 2. State representation

```ts
type Limb = 'LH' | 'RH' | 'LF' | 'RF'
interface ContactState {
  LH: HoldId | null; RH: HoldId | null; LF: HoldId | null; RF: HoldId | null
  hip: { x: number; y: number }   // wall-local meters, from the hip estimator below
}
interface Move {
  from: ContactState; to: ContactState
  limb: Limb; target: HoldId | null           // null = cut feet / let go
  kind: 'reach' | 'match' | 'foot' | 'cut' | 'dyno'
  features: { reach: number; reachMargin: number; crossed: boolean; feetOn: number; heightGain: number; holdQuality: number }
  cost: number; caveats: string[]
}
interface Beta { id: string; moves: Move[]; totalCost: number; summary: string; limitations: string[] }
```

- **Matching.** Two hands on one hold is represented as the same id in `LH` and `RH`, which is allowed only when the hold's radius is above a threshold.
- **Hip estimation.** The hip is not searched over. A small closed-form estimator places it inside the support polygon of the contacts, offset from the wall by an angle-dependent amount, and solves for limb-length feasibility. This keeps the branching factor small. It is a heuristic, not a statement about balance.

## 3. Deterministic search

- **Start state.** Hands go on the start holds (a single start hold means a match). Feet go on the two best usable footholds below and within leg reach.
- **Goal.** Both hands are on finish holds. When there is one finish hold, a match counts as the goal.
- **Successors.** Move one limb at a time to any usable hold within that limb's reach of the estimated shoulder or hip. Prune moves that leave fewer than 3 contacts, unless the style allows dynamic moves and the angle cost permits it. Also prune repeated states and moves where the hands cross by more than a set amount.
- **Cost.** A weighted sum of reach-margin penalty, hold quality, cross-through, feet-off time, and wall-angle multipliers. Progress (gaining height toward the finish) gives a negative contribution. The weights live in one versioned `PlannerConfig` JSON file so they can be tuned and audited.
- **Algorithm.** A beam search of width B (around 64) with a fixed tie-break on `(cost, holdId order)`, so the same input always produces the same output. Diversity comes from rerunning the search with a penalty on states used by earlier betas. A path is kept only if its hand sequence differs from earlier ones. The goal is at least 2 distinct betas.
- **No solution.** Return the explored frontier and the closest state reached, plus the reason: "finish out of reach from every reachable state (needs ≥ X m, profile allows Y m)".
- **Where it runs.** It starts in TypeScript under `src/planner/` for a zero-backend MVP and fast tests. If performance or Python tooling (MuJoCo, OpenCV) is needed later, the same interfaces get a FastAPI port, `POST /plan` taking `{ route, profile, config }` and returning `Beta[]`. The JSON contract is the shared Zod schema exported as JSON Schema.
- **Tests.** Synthetic ladders and traverses with known reachable and unreachable cases, tests that unreachable gaps grow as climber height shrinks, determinism (same input produces byte-identical output), and diversity (the two betas differ).

## 4. Skeleton and IK playback

- **Skeleton.** About 15 joints: pelvis, spine, chest, neck, head, and shoulder, elbow, and wrist on each side, plus hip, knee, and ankle on each side. Bone lengths are scaled from `ClimberProfile`.
- **Placement.** Each `ContactState` becomes end-effector targets on the hold surfaces, at hold centre plus `depth · wallNormal`, using `wallToWorld()`. That is the same transform the current 3D preview uses, so playback lines up with the editor.
- **Solver.** Two-bone analytic IK per limb, with pole vectors (elbows down and out, knees out), after placing the pelvis from the hip estimate. If a target is farther than the limb can reach, the limb extends fully and that limb is drawn in red with a "stretch / IK failure" caveat. It never snaps joints into impossible poses.
- **Animation.** Interpolate between states: move the limb that changes along an arc away from the wall, and ease the pelvis. Controls are play, pause, step, and scrub. Each step shows its `Move.features`, `cost`, and `caveats`.

## 5. Keeping rules apart from explanations

- The planner outputs **structured facts only**: features, costs, and caveats.
- Explanations are built from those facts. At first that is plain templates, such as "Right hand to 5 (sidepull, reach margin 12 cm); feet stay on 9/10". Later, an LLM can turn the facts into prose, but it has **read-only** access to the `Beta`. It cannot add moves, change costs, or claim feasibility, and its output is shown labelled as an explanation, not as validation.
- Any "why not X?" question becomes a planner query, such as rerunning with a forced move and reporting the cost difference or the failing constraint. It is not answered by the model alone.
