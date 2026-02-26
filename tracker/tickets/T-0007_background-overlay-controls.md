# T-0007: Background overlay controls (render + opacity + simple transform)

Created: 2026-02-26
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN

## Goal
Show the plan reference image in the editor and let the user adjust it enough to trace comfortably.

## Acceptance criteria
- [ ] Background image renders in the canvas using `plan.background` source/transform/opacity.
- [ ] User can adjust background opacity from the app UI.
- [ ] User can adjust background position and uniform scale using explicit controls (simple, testable actions).
- [ ] Background transform/opacity changes are persisted in `plan` state (not transient UI state).
- [ ] Rectangle authoring interactions (pan/zoom/select/drag/create/resize) still work with background enabled.

## Notes / formulation
Scope is intentionally limited:
- no rotation
- no perspective/warping
- no multi-image support
- no upload flow yet (use existing local/sample source path)

Prefer reducer actions + pure transform helpers over ad-hoc canvas state mutations.

## Implementation notes
(fill in after completion)

## Log (append-only)
- 2026-02-26 11:31: Ticket created for S002 committed backlog.
