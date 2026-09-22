# Visual Targets — Hexbound Terrain Art Direction

Runtime **must not** sample these images. They are **art-direction references only** (Civ / Humankind / AoW4 readability bar).

All files live under `refs/` — these JPEGs are **not versioned** (binaries stay out of the repo); fetch them with `npm run refs:fetch`. See `refs/SOURCES.md` for Steam CDN provenance and copyright.

## Terrain type → reference mapping

| Terrain / feature (validation) | Primary refs | What to match (feel, not pixels) |
|---|---|---|
| **Plains / Grassland** | `civ7-coastal-plains-forest.jpg`, `civ6-mountains-snow-grassland.jpg`, `aow4-temperate-coast-forest.jpg` | Warm–cool green bands, soft noise detail, readable hex silhouettes |
| **Desert / Dunes** | `aow4-desert-siege.jpg`, `civ6-ocean-forest-desert.jpg`, `humankind-arid-hills-coast.jpg` | Warm sand albedo, ripple/dune shade, arid plateaus |
| **Forest / Rainforest canopy** | `civ6-coast-mountains-forest.jpg`, `aow4-temperate-coast-forest.jpg`, `civ7-coastal-plains-forest.jpg` | Clumped crown silhouettes (P5-B synthetic cross-quad billboards). Shader `canopyField` is understory only — **no GLB / no photo trees** |
| **Hills → Mountains** | `civ6-mountains-snow-grassland.jpg`, `humankind-cliffs-plateaus-rivers.jpg`, `civ7-waterfall-cliffs-arid.jpg` | Continuous steep slopes with slope-driven rock bands and snow line, readable continuous ridges in ortho/oblique (vertical cliff walls are retired per the terrain continuity spec) |
| **Snow peaks / alpine** | `civ7-snow-mountains-harbor.jpg`, `aow4-arctic-snow-mountains.jpg`, `civ6-mountains-snow-grassland.jpg` | Snow line on high elev, cold rock, broken snow edges |
| **Tundra / Ice** | `aow4-arctic-snow-mountains.jpg`, `civ7-snow-mountains-harbor.jpg` | Desaturated cold ground, ice sheen/cracks (procedural) |
| **Shallow / Deep water + shore** | `humankind-coastal-islands.jpg`, `civ7-coastal-plains-forest.jpg`, `civ6-ocean-forest-desert.jpg` | Turquoise shallows → navy deep, foam/shore contrast |
| **Cliffs / arid coasts** | `humankind-arid-hills-coast.jpg`, `civ7-waterfall-cliffs-arid.jpg` | Layered rock banding on steep continuous slopes, dry grass vs stone |
| **Marsh / wetland (bonus)** | `humankind-cliffs-plateaus-rivers.jpg` (river/lowland cues) | Murky green water, mottled “pads” |

## Constraint reminder

- **Allowed:** small synthesized / tiling noise & detail textures (`public/tex/`) for micro-detail (grass/rock/sand/water normals/canopy).
- **Avoid:** full photo terrain albedo atlases as the only look; no tree/rock `.glb`. Synthetic cross-quad canopy billboards are allowed (look-workflow P5-B).
- Appearance = vertex attrs (`terrainId`, `featureId`, `elev`, …) + GLSL FBM / SDF / lighting **plus** optional tiling detail samplers.
- Art refs under `refs/*.jpg` remain **direction only** — do not sample those JPGs in shaders.

## Current status (verified 2026-09-17 18:22; geometry metrics re-baselined 2026-09-19 after the cliff-wall mechanism was retired — official `docs/shots/0*.png`, seed 20260916 except `05`)

User bar: **A** seamless (no mosaic / hard steps / hanging skirts) and **B** landmark 4X look. A per-hex
flat-patch mosaic is **not** an accepted look — that was the defect being fixed, not a style choice.

Freshness note: the 2026-09-19 "fully welded continuous terrain" change removed vertical cliff walls
entirely (`docs/design/2026-09-19-hexbound-goals-and-refs.md` §1.2). Status lines below were re-stated
to that baseline; the pre-retirement wall metrics are history, not targets.

Objective geometry (2026-09-19 baseline): `crackGroups=0`, `attrCracks=0`, `walls=trueWalls=0`,
`maxWallBottomGap=0`, `lowDeltaWalls=0`, `shoreWalls=0`, `worstAttrSpan≈0` — no walls exist any more, so
every seam question reduces to the continuous profile: `profile:check` max single-step delta ≈ 0.0086 wu
(slope-driven, no vertical jumps), `disp:weld` 0 tears over 2557 shared positions.

| Target | Status | Evidence |
|---|---|---|
| A seamless (no mosaic) | partial — colour steps removed, patch *shapes* still cell-derived | Color blend is now a 4×4 cubic B-spline partition of unity: measured blend step across a cell border = 1× the in-cell step (was 22× with the 19-cell gaussian, 1461× with the original 7-cell), truncation error 0.45% → 0. Flat-albedo A/B: with a flat grey albedo the render is uniform (`meanGrad=0.00016`), so no geometric/lighting hex structure remains; relief normals moved to the fragment. Residual: forest and shallow-water patches are still driven by 1-sample-per-cell low bands (`forestCover`, `shoreDist`), so their macro outlines follow the cell mosaic; forest data gained a sub-cell detail band on 2026-09-19 (see Forest patches row); `01`/`04` are still reported as flat per-hex patches in forest/shallow water by `view_image` |
| Hanging skirts | met (retired with the walls) | no side walls exist since the cliff-wall retirement (`walls=0`), so there are no skirts to hang; `02` reports no pale bands |
| Water shallow → deep | partial | depth now comes from the signed shore distance (not a per-cell water flag); `_sx2-3` reads as a broad continuous shelf, `01-canvas` still reads as thin bands/rings |
| Thin beach (not whole-hex) | met | coast = wet sand in the first cell, pale dry sand inland, faded by `waterMask`; `04-canvas` reports a natural shallow-water transition |
| Mountains / ridge | **open (P1)** | Seam-era note said “one continuous ridge”; 2026-09-19 look review: `01` is a cream **massif** (~2/3 of land), not a chain. See Look gap backlog P1 |
| Continuous profile (was "Cliffs only on steep") | met | zero vertical walls anywhere (`walls=trueWalls=0`); any planar cross-section is continuous (`profile:check` max step ≈0.0086 wu). Steepness reads as continuous steep slopes with slope-driven rock/snow shading — vertical cliff walls are **retired** per the terrain continuity spec |
| Forest patches | partial → improving (2026-09-19) | cover continuous, and the baked field now carries a zero-mean sub-cell detail band (goals §2.3-B): the raw forest field's edge-orientation histogram went from 0.91 horizontal-dominated to 0.66 horizontal / rest spread across vertical and ±30° (`field-view` mode 1); the low band is still 1 sample/cell, so macro outlines remain cell-derived |
| Air perspective | met | `01-canvas`: distance haze present |
| Hex rim grid (wire off) | met | no wire renderer: `uShowWireHint` defaults 0 and the rim term is gated on >0.5; the temp `uDbgCoast`/`uDbgHex` debug uniforms used for this round's bisect were removed again |
| Coastline "white line" | reduced, not eliminated | measured cross-shore luma profile over ~8 000 boundary crossings: no rim above both the land and the water mean (`rimAboveBoth=+0.010…+0.015` luma, ≈1.5%), i.e. no bright band; a ~1 px slightly darker contact line remains on the water side. `view_image` still calls the `01` shore a bright line while calling the `04` shore natural |
| Tundra / ice / marsh | not re-verified | no dedicated camera this pass |

## Look gap backlog (2026-09-19)

Authority: `docs/design/2026-09-19-hexbound-look-workflow.md`. Weights are **scheduling** only, not measured ablation. Defect gates (`npm run verify`) stay mandatory and are **not** look progress.

P2 may start **before or in parallel with** P1. P7 blocked until P2 and P3a are each rubric ≥2. P4 hydrology continues on its own track. Ceiling: readable 4X landmarks, not Civ6/Humankind final look.

| ID | Gap vs locked refs | Weight | Layer to change | Status 2026-09-19 |
|---|---|---|---|---|
| **P2** | Clay under fill light; no self-shadow / AO | 25 | CPU height-field sun/AO lightmap into the custom shader | open. Scene lights do not reach `ShaderMaterial`. **Do not wait for P1** |
| **P1** | `01` is one cream massif (~2/3 of land), not a mountain chain | 20 | `mapgen.ts` spine separation + Mountains classification | open. Verify on **elev field / profiles**, not grey albedo |
| **P3a** | Base `biomePalette` too grey/dark (grass `0.14,0.32,0.08`…) | 15 | Raise Grassland/Plains chroma/hue against locked crops | open. Post-tonemap sat 1.22 / contrast 0.58 / split-tone **already exist** — do not retune those first. Do not saturate Desert-on-massif |
| **P3b** | Residual grade after P3a | rest | Small exposure/split tweaks only | blocked until P3a ≥2 |
| **P4** | No readable river in `01`/`04` | 15 | G-Hydro S3 cut → S4 water surface | M1 data green; not on screen |
| **P5-A** | Soft dark-green splat | 5 | `canopyField` as understory only | **explicit ceiling:** will not match ref forest |
| **P5-B** | No separate crown silhouettes | 15 | Synthetic cross-quad billboards (no GLB, no photo atlas) | open; this is the forest completion definition |
| **P6** | Shelf is a uniform cyan halo; foam is white noise | 10 | Narrow shelf, foam only on breaker line, sun spec | partial |
| **P7** | Map-edge sawtooth; weak vertical rock grain | rest | After P2+P3a ≥2 | blocked by policy |

**Locked pairs** (only these may be cited as “closer to ref”):

| Shot | Primary ref crop |
|---|---|
| `01` | `civ6-mountains-snow-grassland.jpg` (chain + foothills + snow; no UI) |
| `02` | same, tight crop. `humankind-cliffs-plateaus-rivers.jpg` only for bedding/lighting — **not** for vertical walls |
| `03` | `humankind-coastal-islands.jpg` or `civ7-coastal-plains-forest.jpg` shore band |
| `04` | `civ6-ocean-forest-desert.jpg` / `humankind-arid-hills-coast.jpg` |
| `05` | no pixel twin; same rubric after reseed |

Humankind sheer-cliff refs are **downweighted**. Continuity spec forbids vertical walls; the look target is Civ6-style continuous landmarks plus steep slopes and terrace **color** bands.

**Do not** treat the Mountains/ridge row above as P1 PASS — that was a seam-era note. P1 is a chain, not a lump. **Do not** treat post-tonemap sat/contrast as an open colour task — that is P3b after P3a. **Do not** score shader canopy as forest-complete.
