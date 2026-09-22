# ShaderToy-Inspired Techniques (Hexbound)

Attribution / adaptation notes for procedural terrain GLSL. Runtime may also sample **small synthesized tiling detail textures** under `public/tex/` (noise / grass / rock / sand / water normals / canopy). **No photo terrain albedo atlases** and **no tree/rock GLB dress** unless later approved.

Primary inspirations (Inigo Quilez / ShaderToy style — adapted, not copied wholesale):

- **Rainforest** — quintic value noise with analytical derivatives (`noised`), FBM with chain-ruled grads (`fbmdX`), soft ellipsoid “treesMap” canopy fields, colored extinction `fog()`.
- **Atmospheric Landscape** — sky zenith/horizon gradient, sun disk + glare, distance haze.

## Ported / adapted building blocks

| Technique | Where | Notes |
|-----------|-------|-------|
| Quintic `noised(vec2)` → `(n, ∂n/∂x, ∂n/∂y)` | `noise.glsl` | C² fade; drives micro-normals & displace |
| `fbmdX` analytical FBM | `noise.glsl` | 4 octaves (vertex-budget) + chain-rule grads |
| `fbm2d` / `ridgeFbmd` gradient FBM | `noise.glsl` | 2-oct / ridged variants returning value **and** gradient |
| Fragment relief normals | `hexTerrain.frag.glsl` | The relief normal is built from `fbm2d`/`ridgeFbmd` at the fragment's world xz, weighted by the blended fields. A per-vertex gradient is constant across a cell top fan, so interpolating it creased the shading on every hex edge (measured with a flat grey albedo: the crease is lighting, not albedo). The vertex shader now only displaces |
| `ridgeFbm` abs-noise | `noise.glsl` + frag/vert mountains | Rock crevices, dune ridges, peaks |
| Soft ellipsoid `canopyField` | `noise.glsl` + frag forest | Cell-local crowns + FBM understory gaps |
| Canopy crown normals | frag forest | Height-field finite differences → per-crown directional light |
| Canopy transmission / rim | frag lighting | Rainforest-style fake subsurface + fresnel rim |
| `fogExtinct` colored fog | frag | Beer-law mix; height-attenuated; lighter density |
| Filmic tonemap + sat/contrast grade | frag end | ACES-ish curve, Civ readability |
| Signed shore distance | `HexMap.recomputeShoreDepth` → `uMapTex1.B` → frag | tex1.B is `water ? 0.5+0.5*shoreDist : 0.5-0.5*landShoreDist` (Euclidean world distance, NORM = 16 hex steps). The fragment recovers a signed distance in hex steps and drives the water mask, the wet/dry sand bands and the water depth from it, so those masks stop being thresholds on a per-cell water flag (which pinned a pale line to the cell boundary). The land/water boundary is a ~1-cell-wide gradient with a one-sided 2-3-cell-wavelength noise perturbation (one hex step is 1.73 world units) |
| Rock strata bands | frag `rockStrata` | Humankind steep-slope rock banding + sediment lines; grey above, warm brown below |
| Snow line by world altitude | frag mountains | Uses displaced `vWorldPos.y`, so only real peaks get snow |
| Sky dome sun disk + glare | `createScene.ts` | Gradient + multi-lobe sun, no HDRI |
| Cubic B-spline palette blend | frag `bspWeights` + 16 unrolled `addMapSample` calls | Surface colour is a 4×4 cubic B-spline partition of unity over the map texels (constant indices, ES1-safe). Weights sum to 1 and are C², so the blend has **no step where the sampled cell set changes**. Measured on a CPU replica: blend step across a cell border = 1× the in-cell step vs 22× for the previous 19-cell gaussian (`exp(-d*d*0.90)`) and 1461× for the original 7-cell `exp(-d*d*0.30)`; truncation error 0.45% → 0, in-cell variation 0.0367 → 0.0486 |
| Strong world-space domain warp | frag `warp`/`warpFine` | The map has one sample per cell, so an unwarped lookup paints every biome/forest patch with the shape of a hexagon. Warping the lookup by ~1.5 cells (+0.55 fine) bends the patch outlines into organic shapes without touching the data |
| Continuous coast distance | `HexMap.recomputeShoreDepth` / `recomputeEdgeMasks` | Euclidean world distance to the nearest land/water cell instead of BFS rings, NORM = 16 hex steps (the BFS version quantized depth into 8 hexagonal terraces) |
| Flat water surface | `hexTerrain.vert.glsl` | Water vertices get no wave displacement: on a 7-vertex cell a wave interpolates into facets (honeycomb sheen). Ripples live in the fragment normal only |
| Smooth height AO | frag | AO uses the mixed fields (`gElevW` / `gReliefW`), not the per-vertex `elev` attribute, which is only C0 across a cell edge |
| Anti-tiling detail sampling | frag `detailLum` | Luminance-only, two rotated samples per terrain, low amplitude |
| Shared-vertex weld | `terrainContinuity.weldFromWorld` | The cells that really meet at a corner are found from world xz, so `elev`/`mountainW`/`forestW`/Y are identical for every copy. **Measured** `crackGroups=0`, `attrCracks=0`, `worstAttrSpan=2.2e-16` |
| World-xz-only noise domain | `hexTerrain.vert.glsl` | Displacement noise takes no `+elev*k`; amplitude comes from welded attributes |
| Geometric edge neighbour | `terrainContinuity.edgeNeighbour` | The cell across edge *i* is found by probing outward from the edge midpoint — the old `AXIAL_DIRS[i]` pointed at a different edge and put walls where no cliff existed. The edge probe now feeds continuity bookkeeping only: the wall mechanism was retired (2026-09-19) and `crack-metric` reports `walls=0` |
| Flat-shore apron | `terrainContinuity.cornerTopY` | Corners shared with water (or OOB) sit at the water line, so the coast is a continuous slope — no shore walls (no walls at all) |
| Welded height field | `terrainContinuity.cellTopY` | Land height = **unconditional** average over the land neighbours sharing the corner (the earlier keep blend-back was removed together with the cliff-wall mechanism); water stays coplanar at `WATER_Y` |
| Top-face-only water tint | frag | Water tint is scaled by `step(0.5, vFaceKind)`. Walls no longer exist, so the tint question reduces to keeping the shore face sand-tinted instead of water-tinted |
| Altitude snow, calibrated | frag mountains | `smoothstep(1.47, 1.89, vWorldPos.y + noise)` × back-slope mask — constants set by screenshot calibration. `scripts/calib-y.ts` was fixed on 2026-09-19 to actually apply displacement (it used to pass `dispW=0`, measuring the undisplaced field), so its distribution is the honest one and the band is due for recalibration in the height-true-source step (goals §2.3-D) |

## Objective seam metrics

`npx tsx scripts/crack-metric.ts` (no pixels, no camera calibration) replays the vertex
displacement on the CPU and reports:

| Metric | Meaning | Current (2026-09-19) |
|---|---|---|
| `crackGroups` | shared-vertex groups whose displaced Y span > 1e-3 | 0 |
| `attrCracks` | shared-vertex groups whose welded `elev`/`mountainW` differ | 0 |
| `maxWallBottomGap` | worst gap between a wall bottom and the neighbour top | 0 |
| `lowDeltaWalls` | walls on neighbour pairs with \|Δelev\| < 0.07 | 0 |
| `walls` / `trueWalls` | emitted walls / those with drop ≥ CLIFF_DROP | **0 / 0** (the wall-emission rule is kept only for metric continuity; the mesher emits no walls) |
| `shoreWalls` / `maxShoreWallDrop` | land→water walls / tallest of them | 0 / 0 |

The continuous-profile counterpart is `npm run profile:check` (max fine-step delta ≈ 0.0086 wu,
slope-driven) and `npm run disp:weld` (0 tears over 2557 shared displaced positions).
`scripts/seam-metric.mjs` (pixel luma across the hex lattice) is **not** camera-calibrated
and is reported as weak evidence only.

## Geometry / gameplay constraints

- Hex chunk mesh (`ChunkMesher`) + field picking retained; **no side walls anywhere** since the
  cliff-wall retirement (2026-09-19).
- Corner elevations are unconditionally averaged over the cells sharing the corner — no delta
  produces a wall or a terrace.
- Vertex FBM micro-displace + elev `smoothstep` boost soften flat hex tops.
- Water hexes share one surface level and the coast reads as a continuous slope into it.
  `HexMap.recomputeShoreDepth()` runs after `recomputeEdgeMasks()`.

## Verification workflow

- `npm run glsl:check` compiles the composed shaders for **both** GLSL ES 1.00 and the 300 es form Babylon uses on WebGL2. ES 3.00 rejects reserved words such as `patch` that ES 1.00 accepts — checking only ES 1.00 hides those failures.
- `npm run shots:iter -- <tag>` grabs three canvas dumps for visual diffing; `npm run shots` regenerates the five canonical captures.
- Shader compile time on ANGLE/D3D11 is ~20-30 s here, so capture scripts poll `__hexbound.chunks.meshes[*].isReady(true)` instead of sleeping a fixed amount.

## Known gaps vs. art refs (measured 2026-09-17 18:22; geometry baseline re-stated 2026-09-19)

- Geometry seams are closed (`crackGroups=0`, `attrCracks=0`, `maxWallBottomGap=0`) and the
  coast emits no walls (`shoreWalls=0`). The *colour* blend no longer steps at a cell border
  (B-spline: 1× the in-cell step, truncation error 0) and the lighting carries no per-cell
  structure (`meanGrad=0.00016` with a flat grey albedo).
- Residual that `view_image` still reports: **flat per-hex patches in forest and shallow water**.
  Both fields are one sample per cell in the data texture (`forestCover`, `shoreDist`), so their
  iso-contours follow the cell mosaic even after blending; and the shoreline's large-scale shape
  is the polygon of the per-cell water data.
- Coast "white line": a cross-shore luma profile over ~8 000 boundary crossings finds **no bright
  rim** above both the land and water means (+0.010…+0.015 luma ≈ 1.5%); a ~1 px slightly darker
  contact line remains on the water side. The judged verdicts disagree between cameras (`04`
  natural, `01`/`03` "bright line"), so treat the per-image verdict as weak evidence.
- Ridge on `01-canvas` is lumpier than the Civ6 refs even though `04-canvas` reads as one
  continuous range; no river valley is reported on `04-canvas`.
- P2 (out of scope this round): sub-cell data sampling or top-face densification so patch
  *shapes* stop following the hex mosaic; waterfall, pick-on-displaced-surface, canopy highlight.
- Do **not** claim "intentional mosaic" or "cliffs met" any more: a per-hex flat mosaic is a
  defect, and the current geometry statement is **no walls at all** — any cross-section is
  continuous (`profile:check`), and steepness is slope-driven shading on continuous slopes.

## Refs (art direction only)

See `docs/VISUAL_TARGETS.md` and `refs/*.jpg` — **do not** sample those JPGs in shaders.
