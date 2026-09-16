# ShaderToy-Inspired Techniques (Hexbound)

Attribution / adaptation notes for procedural terrain GLSL. Runtime may also sample **small synthesized tiling detail textures** under `public/tex/` (noise / grass / rock / sand / water normals / canopy). **No photo terrain albedo atlases** and **no tree/rock GLB dress** unless later approved.

Primary inspirations (Inigo Quilez / ShaderToy style — adapted, not copied wholesale):

- **Rainforest** — quintic value noise with analytical derivatives (`noised`), FBM with chain-ruled grads (`fbmdX`), soft ellipsoid “treesMap” canopy fields, colored extinction `fog()`.
- **Atmospheric Landscape** — sky zenith/horizon gradient, sun disk + glare, distance haze.

## Ported / adapted building blocks

| Technique | Where | Notes |
|-----------|-------|-------|
| Quintic `noised(vec2)` → `(n, ∂n/∂x, ∂n/∂y)` | `noise.glsl` | C² fade; drives micro-normals & displace |
| `fbmdX` analytical FBM | `noise.glsl` | 5 octaves + `transpose(m)` chain rule |
| `ridgeFbm` abs-noise | `noise.glsl` + frag mountains | Spines / rocky albedo |
| Soft ellipsoid `canopyField` | `noise.glsl` + frag forest | Cell-local clumps + FBM wind distort; far LOD = density only |
| `fogExtinct` colored fog | frag | Beer-law mix toward horizon/sky |
| Sky dome sun disk | `createScene.ts` | Procedural sphere shader, no HDRI |
| Tiling detail `sampler2D` | `public/tex/*` + frag | Micro-detail only; albedo still mostly procedural |

## Geometry / gameplay constraints

- Hex prism chunk mesh (`ChunkMesher`) + picking retained.
- Corner elevations blend toward neighbors when deltas are small; large deltas keep cliffs (Humankind terraces).
- Vertex FBM micro-displace + elev `smoothstep` cliff boost soften flat hex tops.

## Refs (art direction only)

See `docs/VISUAL_TARGETS.md` and `refs/*.jpg` — **do not** sample those JPGs in shaders.
