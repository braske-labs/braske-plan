# T-0027: Geometry closure diagnostics v1

Created: 2026-02-28
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-28: OPEN

## Goal
Add a first-pass closure diagnostic that flags clearly open/disconnected enclosure geometry before quantities are trusted.

## Acceptance criteria
- [ ] Validation reports at least one explicit “closure” warning type when enclosure continuity is broken.
- [ ] UI shows closure warning count/message in existing validation surfaces.
- [ ] Debug view can visually locate closure gaps (segment marker/highlight).
- [ ] Existing overlap and invalid-rectangle checks remain unchanged.

## Notes / formulation
- Keep v1 intentionally conservative: catch obvious gaps, avoid expensive full CAD topology solving.

## Implementation notes
- Pending.

## Log (append-only)
- 2026-02-28 13:xx: Ticket created for S006 stretch backlog.
