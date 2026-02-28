# S005: Perimeter foundation sprint — “get to useful geometry”

Dates: 2026-03-05 → 2026-03-12
Goal: Add wall-thickness authoring controls and derive/debug perimeter geometry fast, before sticky magnetic links.

## Sprint backlog (committed)
- T-0018 (3 pts): Per-side wall thickness editing controls (selected rectangle).
- T-0019 (5 pts): Derive wall/perimeter segments v1 from authored rectangles.
- T-0020 (3 pts): Perimeter debug readout + highlight overlay.

Committed points: 11

## Stretch backlog
- T-0021 (3 pts): Room tagging v1 (single-rectangle assignment + room type) for future exclusions.
- T-0022 (3 pts): Wall-rectangle authoring mode for explicit outer-wall primitives.

Stretch points: 6

## Notes / estimates (append-only)
- 2026-02-26: Preplanned during S004 to protect perimeter progress from scope drift.
- 2026-02-26: Persistent magnetic links/unlink are explicitly deferred until after first perimeter/baseboard outputs are working.
- 2026-02-26: `T-0019` should produce explainable derived geometry (segment list/debuggable output), not a black-box total.
- 2026-02-26: `T-0020` can show a perimeter/baseboard candidate length before exclusions; doors/windows and room-type exclusions land later.
- 2026-02-27: Re-scoped from prototype review: treat each authored room as interior+wall shell; `wallCm` must affect shell/contact/perimeter geometry (see `docs/wall_piece_and_shared_boundary_spec.md`).

## Daily notes (append-only)
- 2026-02-26: Sprint planned ahead while discussing wall thickness + perimeter priorities. Do not start before S004 committed goals are wrapped.
- 2026-02-26: S004 closed after delivering committed + stretch scope. Started `T-0018` as first S005 execution ticket.
- 2026-02-26: Implemented `T-0018` wall authoring controls (per-side `wallCm` edit UI + reducer persistence + tests); pending manual verification.
- 2026-02-27: Finished `T-0018` geometry-active wall semantics: shell rendering, shell hit-test/selection, and shell-based drag/resize snapping. Next execution ticket is `T-0019`.
- 2026-02-27: Re-scoped `T-0019` execution to deliver baseboard candidate visibility first (fat red debug overlay toggle), then shared-boundary/enclosure checks.
- 2026-02-27: Implemented `T-0019` v1a baseboard candidate derivation + `Baseboard Debug` toggle (fat red segment overlay) for rapid visual bug-finding.
- 2026-02-27: Implemented `T-0022` selected-rectangle `roomRect`/`wallRect` toggle (`Set As Wall` / `Set As Room`) to support explicit outer-wall primitives.
- 2026-02-28: Advanced `T-0019` v1b in geometry helper: interval-based support segments, same-room shared-boundary pruning, and unsupported-open-side diagnostics.
- 2026-02-28: Next execution ticket after `T-0019` is `T-0020` to expose the new diagnostics clearly in UI overlays/readouts.
- 2026-02-28: Added overlap-pair flashing diagnostics in canvas runtime so validation overlap warnings are directly locatable.

## Review (append-only)
### Shipped
- (append at end of sprint)

### Missed / deferred
- (append at end of sprint)

### Lessons / changes
- (append at end of sprint)
