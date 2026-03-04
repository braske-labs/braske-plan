# LOC and Refactoring Discussion (2026-03-02)

## Context
User request: enumerate JS/HTML/CSS file sizes and list refactoring options to reduce line count, including framework and non-framework paths.

## Current LOC snapshot
- Total JS/HTML/CSS LOC: **27,213**
- Top 5 files: **13,406 LOC (49.3%)**
- Top 10 files: **18,656 LOC (68.6%)**

### By area
- `app/src`: **14,363**
- `app/tests`: **2,374**
- `app` root (`styles.css`, `index.html`): **833**
- `design/stage0_initial_sketches`: **9,538**

## File inventory (lines)
```
7173  app/src/editor/runtime.js
1916  app/src/editor/state/plan.js
1527  design/stage0_initial_sketches/main11.html
1466  design/stage0_initial_sketches/main10.html
1324  app/src/editor/geometry/baseboards.js
1237  design/stage0_initial_sketches/main9.html
1142  design/stage0_initial_sketches/main8.html
1061  app/tests/specs/plan-reducer.test.js
931   design/stage0_initial_sketches/main7.html
879   design/stage0_initial_sketches/main6.html
839   app/src/editor/geometry/snapping.js
820   app/styles.css
774   app/src/editor/state/editor-ui.js
736   design/stage0_initial_sketches/main5.html
671   app/src/editor/persistence/local-plan-storage.js
586   design/stage0_initial_sketches/main4.html
554   design/stage0_initial_sketches/main3.html
487   app/tests/specs/baseboards.test.js
360   app/src/editor/geometry/room-merge.js
349   app/src/ui-shell.js
260   design/stage0_initial_sketches/main2.html
220   design/stage0_initial_sketches/main.html
185   app/src/editor/geometry/room-wall-topology.js
172   app/tests/test-runner.js
172   app/src/editor/geometry/baseboard-snapshot.js
157   app/tests/specs/snapping.test.js
150   app/src/editor/geometry/wall-shell.js
149   app/src/editor/geometry/validation.js
123   app/src/editor/geometry/rectangles.js
105   app/tests/index.html
98    app/tests/specs/baseboard-snapshot.test.js
84    app/tests/specs/room-merge.test.js
82    app/tests/specs/room-wall-topology.test.js
75    app/src/editor/geometry/scale.js
72    app/tests/specs/validation.test.js
63    app/tests/specs/wall-shell.test.js
50    app/tests/specs/scale.test.js
47    app/src/editor/state/session-store.js
47    app/src/editor/geometry/coordinates.js
28    app/tests/specs/coordinates.test.js
20    app/tests/index.js
13    app/index.html
9     app/src/main.js
```

## Per-file refactor opportunities

### Highest-impact source files
1. `app/src/editor/runtime.js` (7173)
   - Split by concern: input controller, renderers, status formatters, room sidebar rendering, estimate rendering.
   - Remove repeated `format*` triplets (debug/status/overlay) with shared formatter helpers.
   - Extract geometry-independent utilities out of runtime.
   - Estimated reduction: **-1200 to -2200 LOC**.

2. `app/src/editor/state/plan.js` (1916)
   - Convert reducer `switch` into action handler map.
   - Share normalizers (`normalizeWallCm`, `normalizeWallSide`, `normalizeNonEmptyString`) with persistence module.
   - Group repeated fixture/opening mutation patterns into reusable helpers.
   - Estimated reduction: **-300 to -550 LOC**.

3. `app/src/editor/geometry/baseboards.js` (1324)
   - Extract interval math (`merge`, overlap, subtraction, clamping) into shared geometry utils.
   - Unify boundary segment conversion paths.
   - Keep algorithm in baseboards; move only generic utilities.
   - Estimated reduction: **-180 to -320 LOC**.

4. `app/src/editor/geometry/snapping.js` (839)
   - Merge duplicated drag/resize candidate flows via strategy tables.
   - Move common axis interval helpers to shared geometry utilities.
   - Estimated reduction: **-120 to -220 LOC**.

5. `app/src/editor/state/editor-ui.js` (774)
   - Replace repetitive toggle/set/clear patterns with generic helpers.
   - Normalize selection slices with one reusable reducer utility.
   - Estimated reduction: **-180 to -280 LOC**.

6. `app/src/editor/persistence/local-plan-storage.js` (671)
   - Reuse shared normalizers with `plan.js`.
   - Isolate legacy migration in a dedicated compat file.
   - Estimated reduction: **-130 to -240 LOC**.

7. `app/src/ui-shell.js` (349)
   - Replace many manual `querySelector` bindings with declarative control map.
   - Build toolbar/panel sections from schema arrays where practical.
   - Estimated reduction: **-120 to -180 LOC**.

8. `app/styles.css` (820)
   - Consolidate repeated disclosure/tree/estimate styles into shared utility classes.
   - Reduce repeated border/radius/spacing declarations via CSS variables or grouped selectors.
   - Estimated reduction: **-120 to -220 LOC**.

### Tests
- `app/tests/specs/plan-reducer.test.js` (1061): switch to factory + table-driven cases (**-250 to -400 LOC**).
- `app/tests/specs/baseboards.test.js` (487): parameterize scenario setup (**-120 to -200 LOC**).
- Remaining test files are already compact; only minor gains.

### Design sketches (`design/stage0_initial_sketches/*.html`, total 9538)
- These are historical prototypes; if retained as-is, no functional problem.
- For LOC reduction:
  - Keep only latest + change notes, or
  - Move common CSS/JS into shared files and slim each HTML file.
- Estimated reduction in this folder alone: **40% to 90%** depending on archival policy.

## Framework discussion

### Option A: stay vanilla JS (recommended first)
- Do internal modular cleanup first.
- Expected net reduction without migration risk: **-2000 to -3800 LOC** (plus optional design archive savings).

### Option B: lightweight framework after cleanup
- **Preact + Signals**: strong reduction in UI wiring, moderate migration risk.
- **Lit**: componentization with minimal conceptual overhead, medium LOC savings.
- **Svelte**: biggest UI LOC drop, highest migration and tooling change.

Conclusion from discussion: cleanup first, framework second if needed.

## Global strategy (proposed)
1. Runtime decomposition (`runtime.js` split into tool/render/sidebar/status modules).
2. Shared normalization/utilities package used by `plan.js`, persistence, and geometry.
3. Geometry interval utility extraction and dedupe (`baseboards`, `snapping`, `room-merge`).
4. Test parametrization and fixture factories.
5. Optional prototype archive compaction.
6. Re-evaluate framework only after steps 1–4.

## Expected net impact
- Realistic near-term (no framework, no sketch archive): **-2k to -3.8k LOC**
- With sketch archive/compaction: additional **-5k to -9.5k LOC**
- With framework migration after cleanup: additional UI reduction possible, but only if accepted migration cost is worth it.
