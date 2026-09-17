# Screenshots

Local validation captures (not runtime assets). Generated via `npm run shots` against a running Vite server (`npm run dev`, default port 5173; override with `npm run shots -- --port <n>`).

Fast iteration loop while tuning shaders:
- `npm start` — one-click launcher (checks deps, generates `public/tex/`, serves, opens browser)
- `npm run glsl:check` — compiles `hexTerrain.{vert,frag}.glsl` in both GLSL ES 1.00 and 300 es; catches errors before a render round-trip
- `npm run shots:iter -- <tag>` — writes `_<tag>-{1,2,3}-canvas.png` (overview / zoomed relief / coastal pan)

Note: terrain shader compilation takes 20-30 s on ANGLE/D3D11 here, so capture scripts wait for mesh readiness instead of a fixed delay.

Judge **canvas** dumps (`*-canvas.png`), not the full-page PNG (HUD/chrome).

| File | Camera | Acceptance items |
|---|---|---|
| `01-overview-default-canvas.png` | default seed, ortho ~18 | P0-4 mosaic, P0-8 default rims, P1-1 ridge at range, P1-7 haze |
| `02-zoomed-cliffs-canvas.png` | zoomed relief | P0-2 skirts, P1-1 ridge, P1-2 snow, P1-3 cliff vs ramp |
| `03-panned-coast-canvas.png` | coastal pan | P0-5 water rings, P0-6 beach width, P1-4 shelf + foam |
| `04-wide-biomes-canvas.png` | pulled back | P0-4/P0-7, P1-5 valley, P1-6 forest patches |
| `05-reseed-diversity-canvas.png` | random seed | P1-8 seam + landmark still present after reseed |

`npm run shots` rewrote these 2026-09-17 18:21:50-18:21:57. Verified all five `0*-canvas.png`
are newer than every file under `src/`, `scripts/`, `public/` (newest source was
`hexTerrain.frag.glsl` at 18:21:13), so no capture predates the code it shows.

Iteration dumps `_<tag>-{1,2,3}-canvas.png` are not the canonical set; only `0N-*-canvas.png` is judged.
`_dbgcoast.png` (4-panel shore-term A/B montage) and `_sx2-3-zoom.png` (magnified coast crop) are
retained as evidence for the coastline investigation; the other `_sx*` dumps are scratch.
Art refs remain under `refs/` (see `refs/SOURCES.md`). ShaderToy technique notes: `docs/shadertoy-refs/TECHNIQUES.md`.
