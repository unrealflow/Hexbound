precision highp float;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUV;
varying float vTerrainId;
varying float vFeatureId;
varying float vElev;
varying float vMoisture;
varying float vEdgeMask;
varying float vHexCorner;
varying float vFaceKind;
varying float vHeightAO;

uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uCamPos;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uGroundAmbient;
uniform float uEnableFog;
uniform float uShowWireHint;
uniform float uUseDetailTex;
uniform float uElevScale;
// Field view for diagnosis: 0 = normal shading, 1..12 = one packed field as
// greyscale (see the block at the end of main). Captured from straight above it
// shows which field a lattice-aligned artifact comes from.
uniform float uDbgField;

uniform sampler2D uNoiseTex;
uniform sampler2D uGrassTex;
uniform sampler2D uRockTex;
uniform sampler2D uSandTex;
uniform sampler2D uWaterNormalTex;
uniform sampler2D uCanopyTex;
uniform sampler2D uMapTex0;
uniform sampler2D uMapTex1;
uniform vec2 uMapOrigin;
uniform vec2 uMapSize;
uniform float uHexSize;

float gWaterW;
float gForestW;
float gShoreW;
float gReliefW;
float gElevW;
float gSandW;
float gTundraW;
float gMtnW;
float gFidW;
/** Relief-perturbed normal built from the continuous world-xz displacement
 *  field; per-vertex gradients are constant per cell fan, so interpolating them
 *  creased the shading along every hex edge. */
vec3 gReliefNrm = vec3(0.0, 1.0, 0.0);

/*__NOISE__*/

// ---------------------------------------------------------------------------
// Tiling micro-detail: luminance-only, two rotated samples so the tile pattern
// stops reading as a repeated blotch (ShaderToy anti-tiling trick).
// ---------------------------------------------------------------------------
float detailLum(sampler2D tex, vec2 p, float scale, float rot) {
  float c = cos(rot);
  float s = sin(rot);
  mat2 R = mat2(c, -s, s, c);
  vec2 q = p * scale;
  float a = dot(texture2D(tex, q).rgb, vec3(0.299, 0.587, 0.114));
  float b = dot(texture2D(tex, R * q + vec2(0.37, 0.61)).rgb, vec3(0.299, 0.587, 0.114));
  return mix(a, b, 0.5);
}

/** Subtle ±amp luminance breakup at a given world scale. */
vec3 microDetail(vec3 albedo, sampler2D tex, vec2 p, float scale, float amp, float rot) {
  if (uUseDetailTex < 0.5) return albedo;
  float lum = detailLum(tex, p, scale, rot);
  return albedo * (1.0 - amp + amp * 2.0 * lum);
}

// ---------------------------------------------------------------------------
// Rock / cliff strata (Humankind layered walls + Rainforest ridged FBM)
// ---------------------------------------------------------------------------
vec3 rockStrata(vec3 wp, float elev, float slope) {
  vec2 p = wp.xz;
  // Thicker, more strongly warped bedding than the first version: the
  // references (humankind-cliffs-plateaus, civ7-waterfall-cliffs) show a few
  // chunky wavy strata per cliff, not fine planks — fine straight bands read
  // as wood grain / cardboard.
  float bandCoord = wp.y * 3.0 + fbm2(p * 1.2) * 3.2;
  float bandVar = mod(floor(bandCoord), 5.0) / 5.0;
  float bandFrac = fract(bandCoord);

  vec3 rockDark = vec3(80.0, 70.0, 60.0) / 255.0;
  vec3 rockOchre = vec3(150.0, 110.0, 70.0) / 255.0;
  vec3 rockLite = vec3(190.0, 170.0, 130.0) / 255.0;
  vec3 rockBrick = vec3(140.0, 70.0, 50.0) / 255.0;

  vec3 rock = mix(rockDark, rockOchre, smoothstep(0.0, 0.55, bandVar));
  rock = mix(rock, rockLite, smoothstep(0.45, 1.0, bandVar) * 0.65);
  rock = mix(rock, rockBrick, smoothstep(0.25, 0.0, abs(bandVar - 0.2)) * 0.65);

  float bedding = smoothstep(0.07, 0.0, abs(bandFrac - 0.5));
  rock *= 1.0 - bedding * 0.12;
  float crack = ridgeFbm(p * 1.1 + wp.y * 0.25);
  rock *= 0.88 + 0.16 * crack;
  rock *= 0.92 + 0.12 * fbm2(p * 3.0 + wp.y);

  if (uUseDetailTex > 0.5) {
    rock = microDetail(rock, uRockTex, p, 0.55, 0.09, 0.6);
  }
  rock = mix(rock, vec3(0.5, 0.51, 0.53), smoothstep(0.72, 1.0, elev) * 0.1);
  return rock;
}

vec3 biomePalette(float tid, float moist, float elev, float waterGate) {
  float m = clamp(moist, 0.0, 1.0);
  float e = clamp(elev, 0.0, 1.0);
  vec3 plains = mix(vec3(0.36, 0.46, 0.15), vec3(0.58, 0.60, 0.24), 0.2 + m * 0.6);
  plains = mix(plains, vec3(0.66, 0.56, 0.30), (1.0 - m) * 0.45);
  vec3 grass = mix(vec3(0.10, 0.26, 0.07), vec3(0.20, 0.44, 0.12), 0.25 + m * 0.55);
  grass = mix(grass, vec3(0.38, 0.58, 0.18), smoothstep(0.45, 0.9, m) * 0.6);
  vec3 sand = mix(vec3(0.74, 0.56, 0.30), vec3(0.94, 0.80, 0.50), e * 0.4);
  vec3 tundra = mix(vec3(0.42, 0.45, 0.42), vec3(0.66, 0.72, 0.72), 0.35 + e * 0.4);
  vec3 hills = mix(grass, vec3(0.46, 0.35, 0.21), 0.28);
  vec3 rock = mix(vec3(0.28, 0.26, 0.24), vec3(0.50, 0.51, 0.53), e);
  vec3 water = vec3(0.18, 0.55, 0.64);
  float w0 = clamp(1.0 - abs(tid - 0.0), 0.0, 1.0);
  float w1 = clamp(1.0 - abs(tid - 1.0), 0.0, 1.0);
  float w2 = clamp(1.0 - abs(tid - 2.0), 0.0, 1.0);
  float w3 = clamp(1.0 - abs(tid - 3.0), 0.0, 1.0);
  float w4 = clamp(1.0 - abs(tid - 4.0), 0.0, 1.0);
  float w5 = clamp(1.0 - abs(tid - 5.0), 0.0, 1.0);
  // Split the palettes by the shore field, not by the terrain id: the id is
  // pre-filtered, so it crosses the water threshold about a cell inland and the
  // land side of every coast would pick up the water palette again. Renormalising
  // each medium separately also keeps land colour free of water tint instead of
  // relying on the caller to subtract it back out.
  float fw = clamp(waterGate, 0.0, 1.0);
  float wl = w0 + w1 + w2 + w3 + w4 + w5;
  vec3 landCol = (w0 * plains + w1 * grass + w2 * sand + w3 * tundra + w4 * hills + w5 * rock) / max(wl, 1e-4);
  return mix(landCol, water, fw);
}

float biomeHeight(float tid, float elev) {
  return mix(0.35 + 0.65 * elev, 0.22, smoothstep(5.5, 6.5, tid));
}

// ---------------------------------------------------------------------------
// Terrain albedo — one bilinear tap per baked map texture, world-space detail
// ---------------------------------------------------------------------------
vec3 terrainAlbedo(float tid, float fid, float elev, float moist, vec3 wp, vec3 n, float camDist) {
  // Assigned from the relief normal below: the geometric normal is the cell's
  // flat fan, so a slope taken from it varies cell to cell and paints the lattice
  // into every slope-driven term (rock, meadow, snow, cliff strata).
  float slope = 0.0;
  vec2 p = wp.xz;
  float hexSize = max(uHexSize, 0.0001);
  vec2 axialP = worldToAxialFrac(p, hexSize);
  // Domain-warp the lookup so biome and forest outlines are organic rather than
  // following the axial lattice. The bake already pre-filters the data, so this
  // only has to break the residual cell alignment, not hide whole hexagons.
  vec2 warp = (vec2(fbm2(p * 0.21 + 3.0), fbm2(p * 0.21 + 29.0)) - 0.5) * 0.46;
  vec2 warpFine = (vec2(fbm2(p * 0.62 + 13.0), fbm2(p * 0.62 + 47.0)) - 0.5) * 0.24;
  vec2 axialPw = axialP + warp + warpFine;

  vec2 uv = (axialPw - uMapOrigin + 0.5) / max(uMapSize, vec2(1.0));
  vec4 t0 = texture2D(uMapTex0, uv);
  vec4 t1 = texture2D(uMapTex1, uv);

  float tidS = t0.r * 8.0;
  float fidW = t0.g * 8.0;
  float elevW = t0.b;
  float moistW = t0.a;
  // t1.r/t1.b are baked unfiltered: the shore fields move by a whole value inside
  // one cell, and pre-filtering them turned the foam line into a wide shelf.
  float sdW = (t1.b - 0.5) * 2.0;
  float forestW = t1.g;
  float reliefW = t1.a;
  float shoreW = t1.r;
  // Medium split from the shore field (see biomePalette): t1.b is 1 on water and
  // expires away from it on land, so this crosses at the waterline itself.
  float waterFrac = smoothstep(-0.12, 0.12, sdW);
  vec3 palWater = biomePalette(tidS, moistW, elevW, 1.0);
  vec3 palLand = biomePalette(tidS, moistW, elevW, 0.0);
  float waterW = waterFrac;
  float sandW = clamp(1.0 - abs(tidS - 2.0), 0.0, 1.0);
  float mtnW = clamp(1.0 - abs(tidS - 5.0), 0.0, 1.0);
  float tundraW = clamp(1.0 - abs(tidS - 3.0), 0.0, 1.0);

  gWaterW = waterW;
  gForestW = forestW;
  gShoreW = shoreW;
  gReliefW = reliefW;
  gElevW = elevW;
  gSandW = sandW;
  gTundraW = tundraW;
  gMtnW = mtnW;
  gFidW = fidW;

  // Relief normal from the continuous world-xz displacement field. Per-vertex
  // gradients are constant across each cell fan, so interpolating them creased
  // the shading along every hex edge; the fragment evaluates the same field's
  // analytic gradient instead. (The wall-face branch is gone with the wall
  // geometry — every fragment is a top face.)
  {
    float landWf = smoothstep(0.02, 0.09, elevW);
    float dHx = 0.0;
    float dHz = 0.0;
    vec3 md = fbm2d(p * 1.1);
    float mMicro = 0.14 * mix(0.55, 0.85, mtnW) * uElevScale * 0.7;
    dHx += md.y * 1.1 * mMicro * landWf;
    dHz += md.z * 1.1 * mMicro * landWf;
    // Same anisotropic ridge domain as the vertex displacement: rp = R*p, then
    // q = rp * (0.32, 0.55), so dV/dp = J^T * (dV/dq) with J = diag(0.32,0.55)*R.
    vec2 rp = mat2(0.866, 0.5, -0.5, 0.866) * p;
    vec3 rd = ridgeFbmd(rp * vec2(0.32, 0.55));
    float mRidge = 0.48 * mtnW * uElevScale;
    dHx += (rd.y * 0.32 * 0.866 + rd.z * 0.55 * 0.5) * mRidge;
    dHz += (-rd.y * 0.32 * 0.5 + rd.z * 0.55 * 0.866) * mRidge;
    vec3 nd = fbm2d(p * 0.55);
    float mDet = 0.12 * mtnW * uElevScale;
    dHx += nd.y * 0.55 * mDet;
    dHz += nd.z * 0.55 * mDet;
    vec3 relief = normalize(vec3(-dHx * 0.70, 1.0, -dHz * 0.70));
    // 0.85 → 0.70: the vertex shader already displaces by this field, so a
    // full-strength normal here double-counts the relief and is what made the
    // massif read as packed worm lumps rather than lit rock. The value still
    // matches the displaced silhouette; only the shading exaggeration is dialed
    // back.
    gReliefNrm = relief;
    slope = 1.0 - clamp(gReliefNrm.y, 0.0, 1.0);
  }

  float mottled = warpedFbm(p * 2.2, 1.35);
  float regional = fbm(p * 0.28 + 3.0);
  elev = elevW;
  moist = moistW;
  tid = 0.0;
  fid = fidW;

  // Organic, uniform-width coastline: the land/water mask comes from the signed
  // shore distance field rather than a threshold on the per-cell elevation.
  // A steeply rising coastal cell crossed the elevation threshold in a fraction
  // of a cell, which painted a thin bright line along the data lattice. The
  // perturbation varies over 2-3 cells (one hex step is 1.73 world units) so it
  // bends the contour itself, and it is one-sided (seaward) so the water colour
  // can never be painted on a land cell that stands above the water plane.
  // One hex step is 0.108 in these units: the perturbation has to reach about a
  // step over a 1-2 cell wavelength, otherwise the waterline keeps drawing the
  // data lattice as a zig-zag; the transition band stays ~1 step wide so no
  // thin line shows up at the coast.
  float coastN = (fbm2(p * 0.33 + 21.0) - 0.5) * 0.15 + (fbm2(p * 0.95) - 0.5) * 0.05;
  float waterMask = smoothstep(-0.07, 0.07, sdW + coastN);
  // One continuous switch, so no medium boundary is ever drawn as a line.
  vec3 pal = mix(palLand, palWater, waterMask);

  vec3 albedo = pal;
  // Two scales of world-space mottle: without the sub-cell term a cell interior
  // is a flat patch of one biome colour, which reads as a hex tile.
  albedo *= 0.90 + 0.14 * mottled + 0.08 * (warpedFbm(p * 4.2, 1.1) - 0.5);
  albedo = mix(microDetail(albedo, uGrassTex, p, 1.8, 0.10, 0.9), albedo, waterMask);
  albedo = mix(albedo, microDetail(albedo, uSandTex, p, 5.0, 0.05, 1.4), sandW * (1.0 - waterMask));

  vec3 soil = vec3(0.46, 0.35, 0.21);
  vec3 grassTint = mix(vec3(0.10, 0.26, 0.07), vec3(0.20, 0.44, 0.12), 0.25 + moist * 0.55);
  vec3 rock = rockStrata(wp, elev, slope);
  float crack = ridgeFbm(p * 1.1 + elev * 0.25);
  float meadow = (1.0 - slope) * (1.0 - smoothstep(0.42, 0.72, elev));
  rock = mix(rock, mix(grassTint * 0.9, soil, 0.35), meadow * 0.45);
  float alt = vWorldPos.y;
  float altNorm = smoothstep(1.4, 3.1, alt);
  rock = mix(rock * vec3(1.04, 1.0, 0.94), rock * vec3(0.94, 0.96, 1.0), altNorm * 0.6);
  // High rock has to sit clearly below the snow's luma or the whole upper
  // massif reads as one pale sheet with no snow line. The crest albedo was
  // measured at ~0.55-0.6 against snow at ~0.8 — not enough separation.
  rock *= mix(1.0, 0.76, smoothstep(1.3, 2.5, alt));
  float scree = smoothstep(0.45, 0.15, crack);
  rock = mix(rock, rock * 0.72, scree * 0.4);
  // Snow band = 70-90% of the measured displaced peak (seed 20260916: 2.63).
  float snowN = (fbm2(p * 2.0 + 1.5) - 0.5) * 0.30;
  float snowLine = smoothstep(1.47, 1.89, alt + snowN);
  snowLine *= smoothstep(0.55, 0.25, slope);
  snowLine *= 0.65 + 0.35 * fbm2(p * 2.4);
  float snowLit = clamp(dot(n, normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
  vec3 snow = mix(vec3(0.78, 0.84, 0.92), vec3(0.955, 0.975, 1.0), snowLit);
  snow *= 0.92 + 0.1 * fbm2(p * 3.0);
  rock = mix(rock, snow, clamp(snowLine, 0.0, 1.0));
  albedo = mix(albedo, rock, max(mtnW, snowLine) * (1.0 - waterMask));
  float relY = gReliefW * 2.0;
  float rampBand = smoothstep(0.14, 0.22, relY) * (1.0 - smoothstep(0.42, 0.50, relY));
  if (vFaceKind < 0.5 && waterMask < 0.5) {
    albedo = mix(albedo, mix(grassTint, rock, 0.45), rampBand * (1.0 - n.y) * 0.9);
  }

  // Depth from the signed shore distance, which the bake now stores as a real
  // world-space distance to the waterline (saturating 2.5 units out). It used to
  // be a per-cell mask that was constant over the whole sea, so the only gradient
  // available was the interpolated sliver between a water and a land cell and the
  // shelf came out as a wide lumpy band.
  // The distance has to be used across its whole range: with a 0.60 gain and a
  // navy ramp starting at 0.40 the deepest water only reached ~55% navy, so the
  // open sea stayed a uniform milky teal with no readable depth.
  float depth = clamp(sdW * 0.95 + (fbm2(p * 1.30) - 0.5) * 0.18 + (fbm2(p * 3.10 + 4.0) - 0.5) * 0.08, 0.0, 1.0);
  // Shallow water must not out-brighten the land, or the shore paint reads as a
  // white line drawn along the coast: keep the near-shore colour saturated and
  // the caustic lift small.
  // Three-stop water profile: a darker wet contact at the waterline, a pale
  // turquoise shelf, then navy.
  vec3 water = mix(vec3(0.10, 0.26, 0.30), vec3(0.22, 0.50, 0.55), smoothstep(0.01, 0.22, depth));
  water = mix(water, vec3(0.04, 0.13, 0.32), smoothstep(0.28, 0.68, depth));
  float caust = fbm2(p * 3.0 + uTime * 0.14);
  float caust2 = fbm2(p * 5.0 - uTime * 0.1 + 4.0);
  float shallowW = 1.0 - smoothstep(0.05, 0.45, depth);
  // The product of two low-frequency fbms is a cellular marble pattern; at lift
  // 0.22 the shelf read as sculpted worm lumps instead of light on water.
  water = mix(water, water * 1.08 + vec3(0.008, 0.014, 0.014), caust * caust2 * 0.12 * shallowW);
  water = microDetail(water, uNoiseTex, p, 1.0, 0.04, 0.5);
  // `step(0.5, vFaceKind)` alone means "wall faces only", so the whole water
  // stack (depth shelf, caustics, water colour) never reached the visible sea:
  // the sea colour came from the per-cell palette instead, which is what painted
  // the pale shallow rim on the waterline and the cell-shaped shallow patches.
  float topFaceW = 1.0 - step(0.5, vFaceKind);
  albedo = mix(albedo, water, waterMask * topFaceW);
  // Contact water: keep the first ~half step of water DARKER than the shelf, so
  // the waterline is not the brightest line in the neighbourhood.
  float contact = (1.0 - smoothstep(0.0, 0.085, sdW + coastN)) * waterMask * topFaceW;
  albedo = mix(albedo, vec3(0.09, 0.22, 0.28), contact * 0.7);

  // --- Forest / rainforest canopy (Rainforest treesMap color language) ---
  float coverAmt = smoothstep(0.18, 0.82, forestW + (fbm2(p * 0.90) - 0.5) * 1.10 + (fbm2(p * 2.3 + 17.0) - 0.5) * 0.45);
  if (coverAmt > 0.02 && waterMask < 0.5 && vFaceKind < 0.5) {
    float canopy = canopyField(p, uTime) * coverAmt;
    float canopyH = canopyHeightFactor(p, uTime) * coverAmt;
    float farLod = smoothstep(16.0, 40.0, camDist);
    float isRain = smoothstep(1.2, 1.8, fid);

    // Dark understory → mid → sunlit crown (warm greens, not teal)
    vec3 canopyDark = mix(vec3(0.035, 0.10, 0.03), vec3(0.03, 0.09, 0.035), isRain);
    vec3 canopyMid  = mix(vec3(0.09, 0.25, 0.06), vec3(0.07, 0.22, 0.07), isRain);
    vec3 canopyHi   = mix(vec3(0.22, 0.43, 0.10), vec3(0.16, 0.38, 0.11), isRain);
    vec3 canopyWarm = mix(vec3(0.44, 0.54, 0.14), vec3(0.22, 0.42, 0.10), isRain);

    vec3 canopyCol = mix(canopyDark, canopyMid, smoothstep(0.12, 0.5, canopy));
    canopyCol = mix(canopyCol, canopyHi, smoothstep(0.4, 0.85, canopyH));
    // At distance the crown lattice and tile grain alias into dots/stripes, so
    // fade both toward broad noise instead.
    float tips = mix(fbm2(p * 4.2 + uTime * 0.12), fbm2(p * 1.1 + 7.0), farLod);
    canopyCol = mix(canopyCol, canopyWarm, tips * canopyH * 0.45);

    // Per-crown tint variation. It has to come from a smooth field: hashing the
    // lattice cell tinted every crown in that cell identically, which painted the
    // forest as a regular grid of tinted dots on top of the dot lattice.
    float crownA = fbm2(p * 0.62 + 19.0);
    float crownB = fbm2(p * 0.47 + 41.3);
    canopyCol *= 0.86 + 0.28 * (crownA * (1.0 - farLod) + 0.5 * farLod);
    canopyCol = mix(canopyCol, canopyCol * vec3(1.18, 1.06, 0.82), crownB * 0.45 * (1.0 - farLod * 0.6));

    if (uUseDetailTex > 0.5) {
      float canopyDetailAmp = 0.05 * (1.0 - farLod);
      canopyCol = microDetail(
        canopyCol, uCanopyTex, p + vec2(uTime * 0.008, 0.0), 2.0, canopyDetailAmp, 0.8
      );
    }

    float cover = mix(clamp(canopy * 1.25, 0.0, 1.0), 0.82 + canopy * 0.18, farLod) * coverAmt;
    vec3 groundPeek = mix(albedo * 0.4, vec3(0.13, 0.10, 0.05), 0.5);
    albedo = mix(albedo, mix(groundPeek, canopyCol, cover), coverAmt);
    // Deeper gaps read as shadow between crowns
    albedo *= 0.82 + 0.24 * canopy;

    // Crown shading: canopies get their own directional light so the canopy
    // reads as 3D mass instead of a flat green patch.
    float cUp = canopyHeightFactor(p + vec2(0.3, 0.0), uTime) - canopyHeightFactor(p - vec2(0.3, 0.0), uTime);
    float cVp = canopyHeightFactor(p + vec2(0.0, 0.3), uTime) - canopyHeightFactor(p - vec2(0.0, 0.3), uTime);
    vec3 cN = normalize(vec3(-cUp * 1.9, 1.0, -cVp * 1.9));
    float cLight = clamp(dot(cN, normalize(uSunDir)), 0.0, 1.0);
    albedo *= mix(0.55, 1.3, cLight);

    // Near LOD: trunk suggestion. Rotated and at a scale that shares no period
    // with the crown lattice, so it cannot reinforce it into a grid.
    if (farLod < 0.88) {
      mat2 trunkRot = mat2(0.825, 0.565, -0.565, 0.825);
      vec2 tp = trunkRot * p * 1.85;
      vec2 cell = floor(tp);
      float trunkHash = hash21(cell);
      vec2 local = fract(tp) - 0.5;
      local += (hash22(cell) - 0.5) * 0.5;
      float trunkDist = length(vec2(local.x * 1.6, local.y * 0.5));
      float trunkMask = smoothstep(0.07, 0.02, trunkDist) * (1.0 - canopy * 0.6);
      trunkMask *= step(0.5, trunkHash) * (1.0 - farLod);
      albedo = mix(albedo, vec3(0.12, 0.08, 0.04), trunkMask * 0.4);
    }

    // Rainforest: hanging vine streaks near camera
    if (isRain > 0.5 && farLod < 0.7) {
      float vine = abs(sin(p.x * 18.0 + fbm2(p * 3.0) * 4.0));
      float vineMask = smoothstep(0.92, 0.98, vine) * canopy * (1.0 - farLod);
      albedo = mix(albedo, vec3(0.06, 0.20, 0.08), vineMask * 0.3);
    }
  }

  // River valley: tex1.R on land is riverDist (0 on the carved path, 1 far), so
  // 1 - gShoreW is river proximity. Placed after the canopy so a river through
  // forest stays visible; the moist bank + narrow water ribbon make the carved
  // lowland readable at range.
  float riverProx = clamp(1.0 - gShoreW, 0.0, 1.0) * (1.0 - waterMask);
  albedo = mix(albedo, vec3(0.18, 0.33, 0.15), smoothstep(0.25, 0.90, riverProx) * 0.55);
  albedo = mix(albedo, vec3(0.20, 0.42, 0.44), smoothstep(0.72, 0.98, riverProx) * 0.6);
  albedo *= 1.0 - 0.20 * smoothstep(0.70, 1.0, riverProx);

  float marshW = clamp(1.0 - abs(fid - 3.0), 0.0, 1.0) * (1.0 - waterW);
  if (marshW > 0.05 && vFaceKind < 0.5) {
    vec3 murk = vec3(0.14, 0.30, 0.20);
    vec3 murkDeep = vec3(0.06, 0.15, 0.11);
    float pads = smoothstep(0.32, 0.72, worley(p * 2.8));
    float film = fbm2(p * 5.0 + uTime * 0.04);
    vec3 marshCol = mix(mix(murkDeep, murk, film), albedo * 0.55, pads * 0.7);
    albedo = mix(albedo, marshCol, marshW);
  }

  float oasisW = clamp(1.0 - abs(fid - 6.0), 0.0, 1.0);
  albedo = mix(albedo, vec3(0.22, 0.52, 0.28), oasisW * 0.7);

  if (vFaceKind < 0.5) {
    // Shore bands from the signed shore distance (negative inland, positive
    // offshore; one hex step ~= 0.108). The old masks keyed off the per-cell
    // water flag, so their window was a sliver pinned to the hex boundary and
    // painted a pale line straight along the coast.
    float s = sdW + (fbm2(p * 1.35 + 11.0) - 0.5) * 0.09 + (fbm2(p * 3.4) - 0.5) * 0.035 + coastN;
    // Damp sand in the first cell of land (measured: a pale band peaking at the
    // waterline leaves a +1.5% luma rim that reads as a white line), dry pale
    // sand further inland where it borders ordinary terrain instead.
    float wet = smoothstep(-0.26, -0.02, s) * (1.0 - smoothstep(-0.02, 0.06, s));
    wet *= (1.0 - waterMask) * (0.60 + 0.40 * fbm2(p * 1.7 + 5.0));
    albedo = mix(albedo, vec3(0.50, 0.45, 0.36), wet * 0.28);
    float dry = smoothstep(-0.62, -0.26, s) * (1.0 - smoothstep(-0.28, -0.10, s));
    dry *= (1.0 - waterMask) * (0.55 + 0.45 * fbm2(p * 1.1 + 5.0));
    albedo = mix(albedo, vec3(0.76, 0.70, 0.55), dry * 0.10);

    // Surf: broken patches a fraction of a unit offshore, width driven by noise,
    // so it reads as breaking water instead of a rim drawn along the coast.
    float surfN = fbm2(p * 1.7 + 9.0);
    float surfBand = 1.0 - smoothstep(0.020, 0.055 + 0.070 * surfN, abs(sdW - (0.080 + 0.050 * surfN)));
    surfBand *= smoothstep(0.45, 0.80, fbm2(p * 2.6 + uTime * 0.04));
    albedo = mix(albedo, vec3(0.70, 0.82, 0.85), clamp(surfBand, 0.0, 1.0) * waterMask * 0.22);

    // No white overlay on the land side: that is what read as a line drawn
    // along the coast.
  }

  // Micro contrast + regional drift + broad continuous tint (no flat cell patches)
  float broad = fbm2(p * 0.32 + 7.0);
  albedo *= 0.90 + 0.20 * broad;
  albedo *= 0.96 + 0.07 * regional;
  return albedo;
}

// ---------------------------------------------------------------------------
// Filmic-ish tonemap (keeps saturation better than pure Reinhard)
// ---------------------------------------------------------------------------
vec3 tonemapFilmic(vec3 x) {
  x = max(x, vec3(0.0));
  x = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return clamp(x, 0.0, 1.0);
}

void main() {
  vec3 n = normalize(vNormal);
  float camDist = length(uCamPos - vWorldPos);

  vec3 albedo = terrainAlbedo(vTerrainId, vFeatureId, vElev, vMoisture, vWorldPos, n, camDist);
  // Smooth relief normal computed inside terrainAlbedo from the world-xz field.
  n = gReliefNrm;

  // Animated micro-normals from blended fields (not per-hex ids)
  {
    float wWaterN = smoothstep(0.25, 0.45, gWaterW) * (1.0 - step(0.5, vFaceKind));
    if (uUseDetailTex > 0.5) {
      vec2 uv1 = vWorldPos.xz * 0.09 + vec2(uTime * 0.02, uTime * 0.014);
      vec2 uv2 = vWorldPos.xz * 0.16 - vec2(uTime * 0.016, -uTime * 0.011);
      vec3 tn1 = texture2D(uWaterNormalTex, uv1).xyz * 2.0 - 1.0;
      vec3 tn2 = texture2D(uWaterNormalTex, uv2).xyz * 2.0 - 1.0;
      vec3 tn = normalize(tn1 + tn2);
      float ripple = mix(0.04, 0.08, 1.0 - smoothstep(0.05, 0.5, gShoreW)) * wWaterN;
      n = normalize(n + vec3(tn.x, 0.0, tn.y) * ripple);
    } else {
      float wx = fbm2(vWorldPos.xz * 2.8 + uTime * 0.4);
      float wz = fbm2(vWorldPos.xz * 2.8 + 17.0 - uTime * 0.34);
      n = normalize(n + vec3((wx - 0.5) * 0.4, 0.0, (wz - 0.5) * 0.4) * wWaterN);
    }
    float wSandN = smoothstep(0.25, 0.45, gSandW) * (1.0 - step(0.5, vFaceKind));
    // Dune ripples live in patches and at low contrast. At amp 0.05 the sine ran
    // across the whole desert as uniform N-S pleats: the albedo field view is
    // smooth there, so the stripes were pure normal shading, and their ~0.57 wu
    // period matches this term exactly.
    float duneMask = smoothstep(0.35, 0.65, fbm2(vWorldPos.xz * 0.5 + 3.0));
    float rip = sin(dot(vWorldPos.xz, normalize(vec2(1.2, 0.4))) * 11.0 + fbm2(vWorldPos.xz * 2.0) * 2.5);
    n = normalize(n + vec3(rip * 0.018, 0.0, rip * 0.011) * wSandN * duneMask);
    float wForestN = smoothstep(0.22, 0.44, gForestW) * (1.0 - step(0.5, vFaceKind));
    float c = canopyField(vWorldPos.xz, uTime) * wForestN;
    n = normalize(n + vec3((c - 0.5) * 0.45, 0.2 + c * 0.2, (fbm2(vWorldPos.zx * 2.4) - 0.5) * 0.35) * wForestN);
  }

  // -------------------------------------------------------------------------
  // Lighting — Rainforest-inspired multi-term model
  // -------------------------------------------------------------------------
  vec3 L = normalize(uSunDir);
  float ndl = max(dot(n, L), 0.0);
  float wrap = max(dot(n, L) * 0.5 + 0.5, 0.0);
  float back = max(dot(n, -L), 0.0);
  float dom = clamp(0.5 + 0.5 * n.y, 0.0, 1.0);
  float fre = clamp(1.0 + dot(n, -normalize(uCamPos - vWorldPos)), 0.0, 1.0);

  vec3 sunCol = vec3(1.34, 1.14, 0.86);
  vec3 skyAmb = uSkyColor * 0.4;
  vec3 groundAmb = uGroundAmbient * 0.7;
  vec3 hemi = mix(groundAmb, skyAmb, dom);

  float canopyT = 0.0;
  float canopyOcc = 1.0;
  float isCanopy = smoothstep(0.22, 0.44, gForestW) * (1.0 - step(0.5, vFaceKind)) * (1.0 - step(0.5, gWaterW));
  {
    float ch = canopyHeightFactor(vWorldPos.xz, uTime);
    canopyOcc = 0.3 + 0.7 * ch;
    float a = clamp(0.5 + 0.5 * dot(n, L), 0.0, 1.0);
    a = a * a * canopyOcc;
    canopyT = back * a * 0.5 * isCanopy;
    // Foliage ambient is greener than open-sky ambient, not sky-blue
    hemi *= mix(vec3(1.0), vec3(0.82, 1.0, 0.78), isCanopy);
  }

  // Base diffuse — stronger sun, weaker ambient (form definition). The old
  // wall-only lifts (sun floor / ground-bounce ambient) are gone with the wall
  // geometry: every fragment is a top face lit by the shared model below.
  vec3 lit = albedo * (hemi * 0.32 + sunCol * ndl * 1.55 + sunCol * wrap * 0.09);

  lit += albedo * sunCol * back * mix(0.05, 0.16, isCanopy);

  if (canopyT > 0.0) {
    vec3 transCol = mix(vec3(0.30, 0.54, 0.14), vec3(0.20, 0.46, 0.12), smoothstep(1.2, 1.8, gFidW));
    lit += transCol * sunCol * canopyT * 0.45;
  }

  float ao = 1.0 - smoothstep(0.0, 0.9, gElevW) * 0.14 - gReliefW * 0.10;
  ao *= mix(1.0, canopyOcc * 0.85 + 0.15, isCanopy);
  ao *= mix(0.66, 1.0, ndl * 0.5 + 0.5);
  float slopeShade = mix(0.62, 1.0, wrap);
  lit *= ao * slopeShade;
  vec3 shTint = mix(vec3(0.12, 0.16, 0.10), vec3(0.12, 0.11, 0.14), clamp(gMtnW, 0.0, 1.0));
  lit = max(lit, albedo * shTint);

  float cliffContact = (1.0 - clamp(n.y, 0.0, 1.0)) * gReliefW;
  lit *= mix(1.0, 0.84, cliffContact * 0.55);

  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 H = normalize(L + V);
  {
    float wWater = smoothstep(0.25, 0.45, gWaterW);
    float isDeep = smoothstep(0.25, 0.75, gShoreW);
    float spec = pow(max(dot(n, H), 0.0), 140.0);
    float spec2 = pow(max(dot(n, H), 0.0), 26.0);
    float sunGlare = pow(max(dot(reflect(-L, n), V), 0.0), 72.0);
    // Branches become smooth weights: a threshold on a smooth field paints a contour.
    lit += vec3(0.8, 0.93, 1.0) * spec * (0.85 - isDeep * 0.35) * wWater;
    lit += vec3(0.28, 0.45, 0.6) * spec2 * (0.2 - isDeep * 0.09) * wWater;
    lit += sunCol * sunGlare * (0.7 - isDeep * 0.3) * wWater;
    // Sky reflection weaker on deep water so navy stays navy
    vec3 skyRef = mix(uHorizonColor, uSkyColor, 0.6);
    lit = mix(lit, skyRef * 0.9, fre * fre * (0.42 - isDeep * 0.22) * wWater);

    float wTundra = smoothstep(0.25, 0.45, gTundraW);
    float specT = pow(max(dot(n, H), 0.0), 64.0);
    lit += vec3(0.75, 0.9, 1.05) * specT * 0.4 * (0.3 + fre) * wTundra;

    float wPlain = (1.0 - wWater) * (1.0 - wTundra);
    float specP = pow(max(dot(n, H), 0.0), 16.0);
    lit += sunCol * specP * 0.03 * wPlain;
  }

  {
    float wForest = smoothstep(0.22, 0.44, gForestW) * (1.0 - step(0.5, vFaceKind));
    lit += vec3(0.4, 0.56, 0.24) * pow(fre, 4.0) * canopyOcc * 0.16 * wForest;
  }

  // Atmospheric fog — lighter, height-aware. Two rounds of tuning went into
  // this: 0.018 flattened the far half of a 30-unit view into haze, and 0.013
  // still left the default overview at 85% fog on the far rim, which read as a
  // pastel wash over the whole map (measured on the terrain pixels only: luma
  // mean 133 and spread 29.6, against 77 and 54.6 with fog disabled). Aerial
  // perspective is wanted at landmark scale, a veil is not.
  if (uEnableFog > 0.5) {
    float density = 0.006;
    vec3 fogCol = mix(uHorizonColor * 0.9, uSkyColor, 0.5);
    fogCol = mix(fogCol, vec3(0.88, 0.78, 0.60), 0.3 * gSandW);
    fogCol = mix(fogCol, vec3(0.45, 0.62, 0.78), 0.3 * gWaterW);
    float heightAtten = mix(1.15, 0.45, clamp(vWorldPos.y / 3.0, 0.0, 1.0));
    lit = fogExtinct(lit, fogCol, camDist * heightAtten, density);
    // Only the far rim fades now; at 36 units this was already taking 14% off the
    // middle of the map, on top of the extinction above.
    float farFade = smoothstep(70.0, 220.0, camDist);
    lit = mix(lit, fogCol, farFade * 0.25);
  }

  if (uShowWireHint > 0.5) {
    float edge = abs(hexSDF((vUV - 0.5) * 1.72));
    float darkRim = 1.0 - smoothstep(0.0, 0.025, edge);
    lit *= 1.0 - darkRim * 0.10;
  }

  // Grade + tonemap
  lit *= 0.96;
  lit = tonemapFilmic(lit);
  lit = pow(max(lit, vec3(0.0)), vec3(0.96));
  float luma = dot(lit, vec3(0.2126, 0.7152, 0.0722));
  lit = mix(vec3(luma), lit, 1.16);
  // Gentler S-curve than pure smoothstep on 0-1
  lit = mix(lit, lit * lit * (3.0 - 2.0 * lit), 0.5);
  lit = clamp(lit, 0.0, 1.0);
  float finalLuma = dot(lit, vec3(0.299, 0.587, 0.114));
  lit = mix(lit * vec3(0.96, 0.98, 1.04), lit * vec3(1.03, 1.0, 0.96), smoothstep(0.3, 0.75, finalLuma));

  // Diagnostic field view (uDbgField != 0): paint the chosen field greyscale and
  // skip the lighting stack. Defaults to 0, so the shipping path is unchanged.
  if (uDbgField > 0.5) {
    float v = 0.0;
    if (uDbgField < 1.5) v = gForestW;
    else if (uDbgField < 2.5) v = gShoreW;
    else if (uDbgField < 3.5) v = gReliefW;
    else if (uDbgField < 4.5) v = gElevW;
    else if (uDbgField < 5.5) v = gFidW;
    else if (uDbgField < 6.5) v = fbm2(vWorldPos.xz * 0.90);
    else if (uDbgField < 7.5) v = gWaterW;
    else if (uDbgField < 8.5) v = gMtnW;
    else if (uDbgField < 9.5) v = dot(albedo, vec3(0.299, 0.587, 0.114));
    else if (uDbgField < 10.5) v = fbm2(vWorldPos.xz * 2.3 + 17.0);
    else if (uDbgField < 11.5) v = canopyField(vWorldPos.xz, uTime);
    else if (uDbgField < 12.5) v = canopyHeightFactor(vWorldPos.xz, uTime);
    // 13: the albedo in colour, not luma — the field views above cannot show a
    // hue, and a wall that reads green is a question about its albedo's hue.
    else if (uDbgField < 13.5) {
      gl_FragColor = vec4(albedo, 1.0);
      return;
    } else v = vFaceKind;
    gl_FragColor = vec4(vec3(v), 1.0);
    return;
  }

  gl_FragColor = vec4(lit, 1.0);
}
