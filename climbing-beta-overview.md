# Project Crux — AI Climbing Beta Studio

**One-line summary:** Turn a photo of a bouldering problem into an editable digital route, generate plausible personalized beta, and animate a 3D climber showing the moves.

## Product vision
A climber photographs a boulder problem, selects its holds, and sees multiple plausible sequences for hands, feet, and body movement. A 3D avatar demonstrates the sequence, and the climber can ask why a move works or explore alternatives. Later, uploaded attempt videos could be compared with suggested beta for feedback.

**Important reality check:** A single RGB image does not reliably reveal hold depth, surface texture, grip quality, or full wall geometry. In early versions, the app must label these properties as estimates and let the user correct them. A visually convincing animation is *not* a physics-valid or safety-certified move.

## User flow
1. Upload a frontal or near-frontal wall photo.
2. Specify wall angle and optionally scale (e.g. known hold size).
3. Mark holds manually; optionally accept model-proposed masks/centers later. Mark start, finish, route holds, and allowed footholds.
4. Give each hold approximate size, orientation, type/grip direction, and difficulty if known.
5. Enter climber height, wingspan (optional), and style preferences (static/dynamic).
6. Generate multiple candidate hand/foot sequences and show why each move was selected.
7. View a step-through 3D avatar on a simplified wall; rotate the camera, play/pause, and inspect limb placements.
8. Correct the beta, save the route, and share a reproducible route file.

## V1 scope (build this first)
- React app with image upload and **manual hold annotation** (click or drag a circle/polygon); undo/edit/delete.
- Route editor: start/finish selection, foothold flags, wall angle input, calibration scale.
- Save/load route definitions in JSON and persist locally or in a simple backend.
- Search-based beta planner using explicit states and configurable reach/contact constraints.
- Return at least two *distinct* candidate sequences when feasible, with a clear no-solution message otherwise.
- Simple 3D wall, approximate holds, and an articulated avatar with IK-assisted poses for each step.
- Playback controls, per-move explanations, and visible uncertainty labels.

### Out of V1
- Accurate reconstruction of hold geometry from one photograph; full-body dynamic physics validation; RL-trained movement; guaranteed safe or optimal beta; coaching/diagnosis from uploaded video; universal hold segmentation; live gym route databases.

## Suggested architecture
- **Frontend:** React, TypeScript, Vite, Tailwind.
- **Editor:** HTML canvas or Konva for image overlay and hold editing.
- **3D:** Three.js with React Three Fiber; lightweight IK solver (or a small custom solver).
- **Planning:** Python + FastAPI service to enumerate/search contact states; start with beam search or A* and explicit heuristics.
- **Storage:** JSON for portable route format; SQLite or PostgreSQL later if needed.
- **CV after V1:** OpenCV, SAM-family segmentation, optionally object detection/fine-tuning with annotated gym images.
- **Later simulation:** MuJoCo or comparable physics engine, only when contact constraints and geometry are strong enough.
- **Later video:** Pose tracking + temporal motion comparison with uncertainty handling.

## Data model and coordinate systems
Define these clearly before writing the planner:
- `Route`: image dimensions, scale estimate, wall angle, hold IDs, allowed holds, start holds, finish holds, version.
- `Hold`: id, image-space `(u,v)`, estimated wall-local `(x,y,z)`, radius, grip type/direction, hand/foot allowances, confidence/source.
- `ClimberProfile`: height, wingspan, limb length estimates, preferences.
- `PoseState`: left/right hand hold ID, left/right foot hold ID, body/hip pose approximation; contact validity.
- `Move`: prior state, new state, moving limb, intended hold, reach score, balance/effort heuristic, caveats.
- `Beta`: ordered states/moves, total score, description, known limitations.

Use a consistent wall-local coordinate system and document pixel-to-wall conversion. The planner should be deterministic with a fixed seed/test input. Avoid impossible transitions by including simple contact and joint-range constraints; don't claim balance physics without simulation.

## Core technical approach
### Route creation
Start with manual annotation, because it gives ground-truth data and a functioning editor even before training CV. Build a small labeled dataset as you use the app; consider segmentation-assisted hold suggestions only later.

### Beta planner
Graph nodes represent a hand/foot contact state and a rough body position. Actions move one limb to another usable hold (add matching or controlled repositioning if needed). Prune unreachable moves; score route progress, reach margin, crossed limbs, foot support, high stretches, and repeated positions. Use beam search/A* to produce diverse candidates with distinct sequences. Surface the planner's constraints and limitations in the UI.

### Avatar
Use a simplified human skeleton and IK to attach wrists/ankles to selected holds and pose the pelvis/torso. Interpolate between states for animation. Mark IK failures or implausible stretches rather than snapping joints into impossible positions. This is **visualization**, not proof of physical validity.

## Milestones
**M0 — Working development environment:** repo, frontend, optional planner backend, reproducible fixtures, tests, README.

**M1 — Photo-to-route editor:** upload image, annotate/edit holds, assign start/finish, wall metadata, save and load JSON. Visualize wall and holds in 2D.

**M2 — Planner:** compute contact sequences for synthetic and annotated problems; return 2 alternatives where possible and an explanatory no-path result when not.

**M3 — 3D beta playback:** simplified 3D wall and climber, limb targets, step/play controls, inspect move scores and caveats.

**M4 — AI assist:** propose hold locations and types from photos, user confirmation, move descriptions and Q&A grounded in planner output.

**M5 — Video analysis:** user-submitted attempt, pose tracking, temporal comparison, suggestions with uncertainty.

## Evaluation and real-world testing
- Synthetic small routes with known reachable/unreachable cases.
- Multiple climber profiles, wall angles, and hold layouts.
- Planner runtime, route completion, limb reach errors, candidate diversity, and IK failures.
- Annotate 10–20 photos from a gym (with permission when needed) and compare proposed beta with actual climber feedback.
- Treat advice as experimental; do not imply the app guarantees safe moves or fall protection.

## Future differentiators
Body-size-aware beta; static vs dynamic strategy selection; real-video replay and comparison; crowd-sourced alternatives; video-to-route extraction; route difficulty estimation; 3D reconstruction with multi-view/depth capture; validated physics-aware planning.

## Initial coding-agent assignment
See `climbing-beta-agent-prompt.md`. Implement M0–M1 first with clean interfaces for planning and rendering; do not attempt to solve the complete research problem in one step.
