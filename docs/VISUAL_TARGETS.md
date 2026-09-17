# Visual Targets — Hexbound Terrain Art Direction

Runtime **must not** sample these images. They are **art-direction references only** (Civ / Humankind / AoW4 readability bar).

All files live under `refs/` — these JPEGs are **not versioned** (binaries stay out of the repo); fetch them with `npm run refs:fetch`. See `refs/SOURCES.md` for Steam CDN provenance and copyright.

## Terrain type → reference mapping

| Terrain / feature (validation) | Primary refs | What to match (feel, not pixels) |
|---|---|---|
| **Plains / Grassland** | `civ7-coastal-plains-forest.jpg`, `civ6-mountains-snow-grassland.jpg`, `aow4-temperate-coast-forest.jpg` | Warm–cool green bands, soft noise detail, readable hex silhouettes |
| **Desert / Dunes** | `aow4-desert-siege.jpg`, `civ6-ocean-forest-desert.jpg`, `humankind-arid-hills-coast.jpg` | Warm sand albedo, ripple/dune shade, arid plateaus |
| **Forest / Rainforest canopy** | `civ6-coast-mountains-forest.jpg`, `aow4-temperate-coast-forest.jpg`, `civ7-coastal-plains-forest.jpg` | Dense canopy color patches, dark understory gaps — **no tree meshes** |
| **Hills → Mountains** | `civ6-mountains-snow-grassland.jpg`, `humankind-cliffs-plateaus-rivers.jpg`, `civ7-waterfall-cliffs-arid.jpg` | Strong elevation steps, rock bands, cliff readability in ortho/oblique |
| **Snow peaks / alpine** | `civ7-snow-mountains-harbor.jpg`, `aow4-arctic-snow-mountains.jpg`, `civ6-mountains-snow-grassland.jpg` | Snow line on high elev, cold rock, broken snow edges |
| **Tundra / Ice** | `aow4-arctic-snow-mountains.jpg`, `civ7-snow-mountains-harbor.jpg` | Desaturated cold ground, ice sheen/cracks (procedural) |
| **Shallow / Deep water + shore** | `humankind-coastal-islands.jpg`, `civ7-coastal-plains-forest.jpg`, `civ6-ocean-forest-desert.jpg` | Turquoise shallows → navy deep, foam/shore contrast |
| **Cliffs / arid coasts** | `humankind-arid-hills-coast.jpg`, `civ7-waterfall-cliffs-arid.jpg` | Layered rock sides, dry grass vs stone |
| **Marsh / wetland (bonus)** | `humankind-cliffs-plateaus-rivers.jpg` (river/lowland cues) | Murky green water, mottled “pads” |

## Constraint reminder

- **Allowed:** small synthesized / tiling noise & detail textures (`public/tex/`) for micro-detail (grass/rock/sand/water normals/canopy).
- **Avoid:** full photo terrain albedo atlases as the only look; no tree/rock `.glb` dress unless necessary.
- Appearance = vertex attrs (`terrainId`, `featureId`, `elev`, …) + GLSL FBM / SDF / lighting **plus** optional tiling detail samplers.
- Art refs under `refs/*.jpg` remain **direction only** — do not sample those JPGs in shaders.

## Current status (verified 2026-09-17 18:22, official `docs/shots/0*-canvas.png`, seed 20260916 except `05`)

User bar: **A** seamless (no mosaic / hard steps / hanging skirts) and **B** landmark 4X look. A per-hex
flat-patch mosaic is **not** an accepted look — that was the defect being fixed, not a style choice.

Freshness: official `0*-canvas.png` were rewritten 18:21:50–18:21:57, i.e. **after** the newest source
file (`hexTerrain.frag.glsl` 18:21:13) — every capture postdates the shader it shows.

Objective geometry (npx tsx scripts/crack-metric.ts): `crackGroups=0`, `attrCracks=0`,
`maxWallBottomGap=0`, `lowDeltaWalls=0/1238`, `walls=trueWalls=38`, `shoreWalls=0`,
`maxShoreWallDrop=0`, `worstAttrSpan=2.2e-16`. All geometry/attribute/wall seams are closed.

| Target | Status | Evidence |
|---|---|---|
| A seamless (no mosaic) | partial — colour steps removed, patch *shapes* still cell-derived | Color blend is now a 4×4 cubic B-spline partition of unity: measured blend step across a cell border = 1× the in-cell step (was 22× with the 19-cell gaussian, 1461× with the original 7-cell), truncation error 0.45% → 0. Flat-albedo A/B: with a flat grey albedo the render is uniform (`meanGrad=0.00016`), so no geometric/lighting hex structure remains; relief normals moved to the fragment. Residual: forest and shallow-water patches are still driven by 1-sample-per-cell data (`forestCover`, `shoreDist`), so their outlines follow the cell mosaic; `01`/`04` are still reported as flat per-hex patches in forest/shallow water by `view_image` |
| Hanging skirts | met (geometry) | `maxWallBottomGap=0`: every wall bottom lands on the neighbour top; `02-canvas` reports no pale skirts |
| Water shallow → deep | partial | depth now comes from the signed shore distance (not a per-cell water flag); `_sx2-3` reads as a broad continuous shelf, `01-canvas` still reads as thin bands/rings |
| Thin beach (not whole-hex) | met | coast = wet sand in the first cell, pale dry sand inland, faded by `waterMask`; `04-canvas` reports a natural shallow-water transition |
| Mountains / ridge | partial | `04-canvas` shows one continuous ridge across the map; `01-canvas` snow on peaks but lumpier than the Civ6 refs |
| Cliffs only on steep | met | 38 walls, all with drop ≥ CLIFF_DROP 0.50 (`walls=trueWalls=38`); zero walls on flat land or at the shore (`lowDeltaWalls=0/1238`, `shoreWalls=0`). This is "no wall unless it is a real cliff" — **not** "every hex edge gets a wall" |
| Forest patches | partial | cover continuous, `coverInOpenRange=411/583` land cells; `04-canvas` still reports the forest as hex-shaped patches (data is 1 sample/cell) |
| Air perspective | met | `01-canvas`: distance haze present |
| Hex rim grid (wire off) | met | no wire renderer: `uShowWireHint` defaults 0 and the rim term is gated on >0.5; the temp `uDbgCoast`/`uDbgHex` debug uniforms used for this round's bisect were removed again |
| Coastline "white line" | reduced, not eliminated | measured cross-shore luma profile over ~8 000 boundary crossings: no rim above both the land and the water mean (`rimAboveBoth=+0.010…+0.015` luma, ≈1.5%), i.e. no bright band; a ~1 px slightly darker contact line remains on the water side. `view_image` still calls the `01` shore a bright line while calling the `04` shore natural |
| Tundra / ice / marsh | not re-verified | no dedicated camera this pass |
