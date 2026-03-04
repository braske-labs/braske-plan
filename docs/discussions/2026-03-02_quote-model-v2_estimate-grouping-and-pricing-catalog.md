# Quote Model v2 Discussion (2026-03-02)

## Why this discussion exists
Current estimate preview is useful but still v1:
- grouped only by room,
- uses fixed hard-coded rates,
- no material profile assignments per room,
- no product catalog assignment for lighting/doors.

Main product objective is reliable, transparent quoting.  
This document defines a practical v2 direction for quote data, UI, and rollout.

## Current baseline (as implemented)
- Estimate panel supports room-level breakdown rows and grand total.
- Quantities come from geometry/room topology:
  - baseboard length,
  - flooring area,
  - painting area,
  - lighting counts.
- Rates are currently hard-coded defaults in runtime:
  - baseboard per meter,
  - flooring per m²,
  - painting per m²,
  - switch per piece,
  - lamp per piece.

## Requested capability set (target)
1. Estimate preview grouping switch:
   - `Group by Room`
   - `Group by Job`
2. Pricing input/editor:
   - global defaults,
   - editable from UI (not code constants).
3. Flooring model:
   - multiple flooring types (example: laminate, tiles),
   - each type has separate `materials` + `work` per m².
4. Room-level package control:
   - enable/disable baseboards per room for quote (without altering geometry).
5. Wall finish model:
   - selectable painting/wall finish profile with `materials` + `work` per m².
6. Lighting pricing:
   - fixture-level assignment to selected products (lamp and switch catalogs).
7. Openings pricing:
   - doors are billable via selected door product/unit price,
   - windows are always free (explicit zero-priced lines).

## Non-goals for this phase
- No geometry rewrite.
- No advanced tax/discount engine yet.
- No multi-currency or supplier sync.
- No openings affecting geometry beyond existing quantity logic.

## Core design principles
1. **Quantities are geometry-derived only.**  
   Pricing logic consumes quantities; it does not mutate geometry.
2. **Rates and assignments are data, not constants.**  
   Everything should live in plan JSON under a quote namespace.
3. **Every subtotal must be explainable.**  
   Keep line-level formula visibility in UI and export.
4. **Room and job views are just two aggregations over same line items.**

## Proposed data model extension

### Top-level
Add `plan.quote` (new schema section; version bump recommended when shipped).

### Suggested shape
```json
{
  "quote": {
    "groupMode": "room",
    "catalog": {
      "flooringTypes": [
        { "id": "floor_laminate", "name": "Laminate", "materialPerM2": 12, "laborPerM2": 16 },
        { "id": "floor_tiles", "name": "Tiles", "materialPerM2": 24, "laborPerM2": 22 }
      ],
      "paintTypes": [
        { "id": "paint_standard", "name": "Standard paint", "materialPerM2": 2.5, "laborPerM2": 7.0 }
      ],
      "switchProducts": [
        { "id": "sw_basic", "name": "Single switch basic", "unitPrice": 22 }
      ],
      "lampProducts": [
        { "id": "lamp_spot_led", "name": "LED spot 7W", "unitPrice": 16 }
      ],
      "doorProducts": [
        { "id": "door_std_80", "name": "Interior door 80cm", "unitPrice": 145 }
      ],
      "baseboardProfiles": [
        { "id": "bb_std", "name": "Baseboard standard", "materialPerM": 6, "laborPerM": 12 }
      ]
    },
    "defaults": {
      "flooringTypeId": "floor_laminate",
      "paintTypeId": "paint_standard",
      "baseboardProfileId": "bb_std"
    },
    "roomOverrides": {
      "room_abc": {
        "includeBaseboard": true,
        "flooringTypeId": "floor_tiles",
        "paintTypeId": "paint_standard"
      }
    }
  }
}
```

### Entity-level assignments
- Lighting fixture (`entities.lighting.fixtures[*]`):
  - add `productId` (catalog id; validated by fixture kind).
- Opening (`entities.openings[*]`):
  - for `kind=door` add `productId` (from `doorProducts`).
  - for `kind=window` ignore `productId` for pricing and force price `0`.

## Quote calculation model

### Canonical line-item pipeline
1. Build quantity facts from existing geometry pipeline.
2. Resolve room/package assignments + defaults.
3. Create normalized quote line items:
   - baseboard (m),
   - flooring (m²),
   - painting (m²),
   - switches (pcs + selected product),
   - lamps (pcs + selected product),
   - doors (pcs + selected product),
   - windows (pcs, always zero).
4. Compute amount per line:
   - `amount = qty × (material + labor)` for area/length jobs,
   - `amount = count × unitPrice` for product jobs.
5. Aggregate to display model:
   - by room view, or
   - by job view.

### Important formulas
- Baseboard amount per room:
  - if `includeBaseboard=false` => `0`.
  - else `baseboardMeters × (baseboard.materialPerM + baseboard.laborPerM)`.
- Flooring amount per room:
  - `roomAreaM2 × (flooring.materialPerM2 + flooring.laborPerM2)`.
- Painting amount per room:
  - `paintAreaM2 × (paint.materialPerM2 + paint.laborPerM2)`.
- Lighting:
  - `sum(fixtureCountByProduct × product.unitPrice)`.
- Doors:
  - `doorCountByProduct × product.unitPrice`.
- Windows:
  - always `0` with explicit line: `"Windows (free)": qty × 0`.

## UI proposal

### Estimate panel controls (top strip)
- Group mode segmented control:
  - `By Room` | `By Job`
- `Rates / Catalog` button opens editor drawer/modal.
- Optional `Show formulas` toggle for dense/compact view.

### Catalog editor
Sections:
1. Baseboard profiles (material + labor / m).
2. Flooring types (material + labor / m²).
3. Paint types (material + labor / m²).
4. Lighting products:
   - lamp products,
   - switch products.
5. Door products.
6. Windows note: fixed free.

Actions:
- add / rename / delete type,
- set defaults.

### Room sidebar integration
Inside each room card:
- Quote package switches:
  - baseboard include on/off.
- Dropdowns:
  - flooring type,
  - paint type.
- Quick totals preview:
  - room quote subtotal.

### Canvas interactions
- Click lamp/switch: property panel includes product selector.
- Click door opening: property panel includes door product selector.
- Window opening: show `Cost: free` badge (no selector needed unless for reporting metadata).

## Grouping behavior details

### By Room
- Existing structure remains intuitive for per-room review.
- Each room shows package subtotals and room total.
- Good for client walkthrough and room-by-room validation.

### By Job
- Top-level groups:
  - Baseboards,
  - Flooring,
  - Painting,
  - Lighting,
  - Doors,
  - Windows (free).
- Each job group expands to room-level lines and then detailed quantity intervals/items.
- Good for contractor procurement and labor planning.

## Validation and guardrails
1. Catalog references must resolve; otherwise fallback to default and show warning.
2. Deleted catalog item should not crash; orphaned assignments marked and recoverable.
3. If scale missing:
   - display quantities in world units and block monetary total for length/area-based jobs.
4. Keep update latency target (sub-200ms) by caching derived quantity facts.

## Export / report implications
- Keep estimate preview printable.
- Add quote snapshot export payload:
  - line items,
  - aggregation mode,
  - totals,
  - warnings (unassigned products, missing scale).
- This enables deterministic PDF generation later.

## Rollout proposal (slices)
1. **Slice A (core model + UI toggle)**
   - Add `plan.quote` skeleton + group mode.
   - Implement `By Room` / `By Job` rendering from same line-item source.
2. **Slice B (flooring/paint/baseboard assignments)**
   - Catalog + room overrides.
   - Global and room-level editors.
3. **Slice C (lighting + doors products)**
   - Fixture and door product assignment.
   - Cost integration in estimate lines.
   - Windows fixed free lines.
4. **Slice D (report hardening)**
   - Validation warnings,
   - quote snapshot export,
   - print polish.

## Risks and mitigations
- **Risk:** UI complexity overload.  
  **Mitigation:** keep simple defaults; hide advanced controls behind expandable sections.
- **Risk:** stale catalog references after edits.  
  **Mitigation:** validation + fallback defaults + repair actions.
- **Risk:** estimate divergence from quantities.  
  **Mitigation:** single canonical line-item builder shared by all estimate views.

## Conclusion
The v2 quote model should treat estimate as a first-class, configurable data layer over existing geometry quantities.  
Room/job grouping, catalog-driven rates, room overrides, product assignment, and explicit free windows together provide a realistic path to final objective: reliable contractor-grade quote output.
