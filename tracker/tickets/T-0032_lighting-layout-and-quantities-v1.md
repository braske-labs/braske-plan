# T-0032: Lighting layout + quantity model v1

Created: 2026-03-01
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-03-01: OPEN
- 2026-03-01: IN PROGRESS (formulation)
- 2026-03-01: IN PROGRESS (slice B/C core implementation)
- 2026-03-01: DONE

## Goal
Introduce a first-pass model for switches and luminaires with per-room counts and simple schedule outputs.

## Acceptance criteria
- [x] Add `entities.lighting` with `fixtures`, `groups`, `links`.
- [x] Support fixture kinds: `switch` and `lamp`.
- [x] Support switch → lamp and switch → lampGroup links.
- [x] Show per-room and total counts by fixture subtype in sidebar/readout.
- [x] Export/import persists lighting entities and link graph.

## Notes / formulation
- v1 is quantity-focused, not full electrical-circuit simulation.
- Lamp arrays (3/6/9) are represented as `lampGroup` over member lamp fixtures.
- Switches are wall-hosted entities and slide only along host wall side.
- Companion spec: `docs/lighting_model_v1.md`.

## Implementation slices

### Slice A (2 pts) — model + persistence + totals
- extend plan schema (`entities.lighting`)
- persistence normalization
- derived count helpers + sidebar totals

### Slice B (3 pts) — fixture placement/edit
- tools: place switch/place lamp
- move/delete fixtures
- switch host constraint on wall side

### Slice C (3 pts) — linking and groups
- create lamp groups
- create/remove switch links
- debug overlay for link lines

### Slice D (2 pts) — validation + export derived
- dangling reference checks
- derived lighting snapshot in export payload

## Implementation notes
- Started formulation and schema specification.

## Log (append-only)
- 2026-03-01 13:xx: Ticket created from planning discussion (lighting + switch inventory).
- 2026-03-01 13:xx: Detailed v1 model and implementation slices documented in `docs/lighting_model_v1.md`.
- 2026-03-01 14:xx: Added fixture actions in reducer (`add/move/delete`, switch→target links), runtime tools (`Place Switch`, `Place Lamp`, `Link Lights`), fixture rendering and drag behavior, and reducer tests.
- 2026-03-01 15:xx: Added lamp groups (`create/delete`), switch→group linking controls, export `derived.lighting` snapshot, lighting validation warnings, subtype breakdowns, and fixture glue-to-rectangle behavior on rectangle moves.
