# Visual Targets — Hexbound Terrain Art Direction

Runtime **must not** sample these images. They are **art-direction references only** (Civ / Humankind / AoW4 readability bar).

All files live under `refs/` (copied from `/workspace/hexbound-refs/`). See `refs/SOURCES.md` for Steam CDN provenance and copyright.

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
