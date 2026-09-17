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
varying float vShoreDist;

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
float gWetInv;
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
  float bandCoord = wp.y * 4.5 + fbm2(p * 1.2) * 2.2;
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
  rock *= 1.0 - bedding * 0.2;
  float crack = ridgeFbm(p * 1.1 + wp.y * 0.25);
  rock *= 0.84 + 0.22 * crack;
  rock *= 0.92 + 0.12 * fbm2(p * 3.0 + wp.y);

  if (uUseDetailTex > 0.5) {
    rock = microDetail(rock, uRockTex, p, 0.55, 0.09, 0.6);
  }
  rock = mix(rock, vec3(0.5, 0.51, 0.53), smoothstep(0.72, 1.0, elev) * 0.1);
  return rock;
}

vec3 biomePalette(float tid, float moist, float elev) {
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
  float w6 = clamp(1.0 - abs(tid - 6.0), 0.0, 1.0);
  float w7 = clamp(1.0 - abs(tid - 7.0), 0.0, 1.0);
  vec3 c = w0 * plains + w1 * grass + w2 * sand + w3 * tundra + w4 * hills + w5 * rock + (w6 + w7) * water;
  return c / max(w0 + w1 + w2 + w3 + w4 + w5 + w6 + w7, 0.001);
}

float biomeHeight(float tid, float elev) {
  return mix(0.35 + 0.65 * elev, 0.22, smoothstep(5.5, 6.5, tid));
}

void considerNbr(vec2 cellQR, vec2 axialP, inout vec2 nA, inout vec2 nB, inout float dA, inout float dB) {
  float dd = axialDistance(axialP, cellQR);
  if (dd < dA) {
    dB = dA;
    nB = nA;
    dA = dd;
    nA = cellQR;
  } else if (dd < dB) {
    dB = dd;
    nB = cellQR;
  }
}

// Uniform cubic B-spline basis, t in [0,1): weights for the nodes
// floor(x)-1 .. floor(x)+2. Sums to 1 exactly and is C2 in x.
vec4 bspWeights(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4(
    (1.0 - t) * (1.0 - t) * (1.0 - t) / 6.0,
    (3.0 * t3 - 6.0 * t2 + 4.0) / 6.0,
    (-3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0) / 6.0,
    t3 / 6.0);
}

void addMapSample(vec2 cellQR, float w, inout float wSum, inout vec3 pal, inout vec3 palW, inout float waterW, inout float forestW, inout float shoreW, inout float wetInv, inout float reliefW, inout float elevW, inout float moistW, inout float fidW, inout float sandW, inout float mtnW, inout float tundraW, inout float sdW) {
  vec2 uv = (cellQR - uMapOrigin + 0.5) / max(uMapSize, vec2(1.0));
  vec4 t0 = texture2D(uMapTex0, uv);
  vec4 t1 = texture2D(uMapTex1, uv);
  float tid = t0.r * 8.0;
  // Water flag from the terrain id, not from t1.b: t1.b now carries the signed
  // shore distance (water positive, land negative).
  float isWaterCell = (tid > 5.5) ? 1.0 : 0.0;
  vec3 pcol = biomePalette(tid, t0.a, t0.b);
  pal += w * pcol;
  palW += w * isWaterCell * pcol;
  waterW += w * isWaterCell;
  forestW += w * t1.g;
  shoreW += w * t1.r;
  wetInv += w * isWaterCell;
  sdW += w * ((t1.b - 0.5) * 2.0);
  reliefW += w * t1.a;
  elevW += w * t0.b;
  moistW += w * t0.a;
  fidW += w * (t0.g * 8.0);
  sandW += w * clamp(1.0 - abs(tid - 2.0), 0.0, 1.0);
  mtnW += w * clamp(1.0 - abs(tid - 5.0), 0.0, 1.0);
  tundraW += w * clamp(1.0 - abs(tid - 3.0), 0.0, 1.0);
  wSum += w;
}

// ---------------------------------------------------------------------------
// Terrain albedo — hex-weighted palettes, world-space detail once
// ---------------------------------------------------------------------------
vec3 terrainAlbedo(float tid, float fid, float elev, float moist, vec3 wp, vec3 n, float camDist) {
  float slope = 1.0 - clamp(n.y, 0.0, 1.0);
  vec2 p = wp.xz;
  float hexSize = max(uHexSize, 0.0001);
  vec2 axialP = worldToAxialFrac(p, hexSize);
  // Domain-warp the cell lookup: the data texture has one sample per cell, so
  // an unwarped lookup paints every biome/forest patch with the shape of a
  // hexagon. A warp of ~1.5 cells distorts the patch outlines into organic
  // shapes while keeping the data itself untouched.
  vec2 warp = (vec2(fbm2(p * 0.21 + 3.0), fbm2(p * 0.21 + 29.0)) - 0.5) * 1.5;
  vec2 warpFine = (vec2(fbm2(p * 0.62 + 13.0), fbm2(p * 0.62 + 47.0)) - 0.5) * 0.8;
  vec2 axialPw = axialP + warp + warpFine;

  float wSum = 0.0;
  vec3 pal = vec3(0.0);
  vec3 palW = vec3(0.0);
  float waterW = 0.0;
  float forestW = 0.0;
  float shoreW = 0.0;
  float wetInv = 0.0;
  float reliefW = 0.0;
  float elevW = 0.0;
  float moistW = 0.0;
  float fidW = 0.0;
  float sandW = 0.0;
  float mtnW = 0.0;
  float tundraW = 0.0;
  float sdW = 0.0;
  // 4x4 cubic B-spline stencil (constant indices, ES1-safe): C2 partition of
  // unity, so the blend neither steps at a cell border (the truncated Gaussian
  // swapped its cell set there) nor stays flat inside a cell.
  vec2 f0 = floor(axialPw);
  vec4 wx = bspWeights(axialPw.x - f0.x);
  vec4 wz = bspWeights(axialPw.y - f0.y);
  vec2 base = f0 - vec2(1.0, 1.0);
  addMapSample(base + vec2(0.0, 0.0), wx[0] * wz[0], wSum, pal, palW, waterW, forestW, shoreW, wetInv, reliefW, elevW, moistW, fidW, sandW, mtnW, tundraW, sdW);
  addMapSample(base + vec2(0.0, 1.0), wx[0] * wz[1], wSum, pal, palW, waterW, forestW, shoreW, wetInv, reliefW, elevW, moistW, fidW, sandW, mtnW, tundraW, sdW);
  addMapSample(base + vec2(0.0, 2.0), wx[0] * wz[2], wSum, pal, palW, waterW, forestW, shoreW, wetInv, reliefW, elevW, moistW, fidW, sandW, mtnW, tundraW, sdW);
  addMapSample(base + vec2(0.0, 3.0), wx[0] * wz[3], wSum, pal, palW, waterW, forestW, shoreW, wetInv, reliefW, elevW, moistW, fidW, sandW, mtnW, tundraW, sdW);
  addMapSample(base + vec2(1.0, 0.0), wx[1] * wz[0], wSum, pal, palW, waterW, forestW, shoreW, wetInv, reliefW, elevW, moistW, fidW, sandW, mtnW, tundraW, sdW);
  addMapSample(base + vec2(1.0, 1.0), wx[1] * wz[1], wSum, pal, palW, waterW, forestW, shoreW, wetInv, reliefW, elevW, moistW, fidW, sandW, mtnW, tundraW, sdW);
  addMapSample(base + vec2(1.0, 2.0), wx[1] * wz[2], wSum, pal, palW, waterW, forestW, shoreW, wetInv, reliefW, elevW, moistW, fidW, sandW, mtnW, tundraW, sdW);
  addMapSample(base + vec2(1.0, 3.0), wx[1] * wz[3], wSum, pal, palW, waterW, forestW, shoreW, wetInv, reliefW, elevW, moistW, fidW, sandW, mtnW, tundraW, sdW);
  addMapSample(base + vec2(2.0, 0.0), wx[2] * wz[0], wSum, pal, palW, waterW, forestW, shoreW, wetInv, reliefW, elevW, moistW, fidW, sandW, mtnW, tundraW, sdW);
  addMapSample(base + vec2(2.0, 1.0), wx[2] * wz[1], wSum, pal, palW, waterW, forestW, shoreW, wetInv, reliefW, elevW, moistW, fidW, sandW, mtnW, tundraW, sdW);
  addMapSample(base + vec2(2.0, 2.0), wx[2] * wz[2], wSum, pal, palW, waterW, forestW, shoreW, wetInv, reliefW, elevW, moistW, fidW, sandW, mtnW, tundraW, sdW);
  addMapSample(base + vec2(2.0, 3.0), wx[2] * wz[3], wSum, pal, palW, waterW, forestW, shoreW, wetInv, reliefW, elevW, moistW, fidW, sandW, mtnW, tundraW, sdW);
  addMapSample(base + vec2(3.0, 0.0), wx[3] * wz[0], wSum, pal, palW, waterW, forestW, shoreW, wetInv, reliefW, elevW, moistW, fidW, sandW, mtnW, tundraW, sdW);
  addMapSample(base + vec2(3.0, 1.0), wx[3] * wz[1], wSum, pal, palW, waterW, forestW, shoreW, wetInv, reliefW, elevW, moistW, fidW, sandW, mtnW, tundraW, sdW);
  addMapSample(base + vec2(3.0, 2.0), wx[3] * wz[2], wSum, pal, palW, waterW, forestW, shoreW, wetInv, reliefW, elevW, moistW, fidW, sandW, mtnW, tundraW, sdW);
  addMapSample(base + vec2(3.0, 3.0), wx[3] * wz[3], wSum, pal, palW, waterW, forestW, shoreW, wetInv, reliefW, elevW, moistW, fidW, sandW, mtnW, tundraW, sdW);
  wSum = max(wSum, 0.0001);
  pal /= wSum;
  palW /= wSum;
  // Palette per medium: the water palette bleeding onto land pixels was the last
  // bright rim at the coast (measured +0.014 luma on the land side).
  float waterFrac = clamp(waterW / wSum, 0.0, 1.0);
  vec3 palLand = (pal - palW) / max(1.0 - waterFrac, 0.02);
  vec3 palWater = palW / max(waterFrac, 0.02);
  waterW /= wSum;
  forestW /= wSum;
  shoreW /= wSum;
  wetInv /= wSum;
  reliefW /= wSum;
  elevW /= wSum;
  moistW /= wSum;
  fidW /= wSum;
  sandW /= wSum;
  mtnW /= wSum;
  tundraW /= wSum;
  sdW /= wSum;
  gWaterW = waterW;
  gForestW = forestW;
  gShoreW = shoreW;
  gReliefW = reliefW;
  gElevW = elevW;
  gSandW = sandW;
  gTundraW = tundraW;
  gMtnW = mtnW;
  gFidW = fidW;
  gWetInv = wetInv;

  // Relief normal from the continuous world-xz displacement field, weighted by
  // the blended fields. Per-vertex gradients are constant across each cell fan,
  // so interpolating them creased the shading along every hex edge.
  {
    float topW = 1.0 - step(0.5, vFaceKind);
    float landWf = smoothstep(0.02, 0.09, elevW) * topW;
    float dHx = 0.0;
    float dHz = 0.0;
    vec3 md = fbm2d(p * 1.1);
    float mMicro = 0.14 * mix(0.55, 1.0, mtnW) * uElevScale * 0.7;
    dHx += md.y * 1.1 * mMicro * landWf;
    dHz += md.z * 1.1 * mMicro * landWf;
    vec3 rd = ridgeFbmd(p * 0.45);
    float mRidge = 0.55 * mtnW * uElevScale;
    dHx += rd.y * 0.45 * mRidge;
    dHz += rd.z * 0.45 * mRidge;
    vec3 nd = fbm2d(p * 0.55);
    float mDet = 0.12 * mtnW * uElevScale;
    dHx += nd.y * 0.55 * mDet;
    dHz += nd.z * 0.55 * mDet;
    vec3 relief = normalize(vec3(-dHx * 0.85, 1.0, -dHz * 0.85));
    gReliefNrm = normalize(mix(n, relief, 0.75 * topW));
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
  pal = mix(palLand, palWater, waterMask);

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
  float scree = smoothstep(0.45, 0.15, crack);
  rock = mix(rock, rock * 0.72, scree * 0.4);
  // Snow band = 70-90% of the measured displaced peak (seed 20260916: 2.63).
  float snowN = (fbm2(p * 2.0 + 1.5) - 0.5) * 0.30;
  float snowLine = smoothstep(1.47, 1.89, alt + snowN);
  snowLine *= smoothstep(0.55, 0.25, slope);
  snowLine *= 0.65 + 0.35 * fbm2(p * 2.4);
  float snowLit = clamp(dot(n, normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
  vec3 snow = mix(vec3(0.690, 0.769, 0.871), vec3(0.941, 0.973, 1.0), snowLit);
  snow *= 0.92 + 0.1 * fbm2(p * 3.0);
  rock = mix(rock, snow, clamp(snowLine, 0.0, 1.0));
  albedo = mix(albedo, rock, max(mtnW, snowLine) * (1.0 - waterMask));
  float relY = gReliefW * 2.0;
  float rampBand = smoothstep(0.14, 0.22, relY) * (1.0 - smoothstep(0.42, 0.50, relY));
  if (vFaceKind < 0.5 && waterMask < 0.5) {
    albedo = mix(albedo, mix(grassTint, rock, 0.45), rampBand * (1.0 - n.y) * 0.9);
  }

  // Depth from the signed shore distance: t1.r mixes shoreDist (water) with
  // riverDist (land) across the waterline, so a bilinear read of it makes the
  // near-shore water jump in depth and paint cell-shaped pale patches. The
  // per-cell field is constant inside a shore ring, so the noise has to be at
  // ring scale or the shelf reads as flat pale hexagons and ring bands.
  float depth = clamp(sdW * 0.60 + (fbm2(p * 1.30) - 0.5) * 0.22 + (fbm2(p * 3.10 + 4.0) - 0.5) * 0.10, 0.0, 1.0);
  // Shallow water must not out-brighten the land, or the shore paint reads as a
  // white line drawn along the coast: keep the near-shore colour saturated and
  // the caustic lift small.
  // Three-stop water profile: a darker wet contact at the waterline, a pale
  // turquoise shelf, then navy. A monotone pale-at-the-shore ramp made the
  // waterline the brightest line in the frame (measured +0.029 luma rim).
  vec3 water = mix(vec3(0.10, 0.26, 0.30), vec3(0.34, 0.62, 0.64), smoothstep(0.02, 0.15, depth));
  water = mix(water, vec3(0.05, 0.16, 0.34), smoothstep(0.28, 0.62, depth));
  float caust = fbm2(p * 2.6 + uTime * 0.14);
  float caust2 = fbm2(p * 4.4 - uTime * 0.1 + 4.0);
  float shallowW = 1.0 - smoothstep(0.05, 0.45, depth);
  water = mix(water, water * 1.10 + vec3(0.01, 0.02, 0.02), caust * caust2 * 0.22 * shallowW);
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

  // Cliff sides only on high-relief edges (relief > CLIFF_DROP in world Y)
  if (vFaceKind > 0.5) {
    float cliffSlope = clamp(slope * 0.5 + 0.7, 0.0, 1.0);
    vec3 cliff = rockStrata(wp + vec3(0.0, elev * 1.6, 0.0), elev, cliffSlope);
    float vertBand = sin(wp.y * 6.5 + fbm2(p * 1.8) * 2.0);
    cliff *= 0.52 + 0.08 * vertBand;
    float sunW = clamp(dot(n, normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
    vec3 aridCliff = mix(vec3(0.360, 0.245, 0.160), vec3(0.690, 0.530, 0.310), sunW);
    cliff = mix(cliff, aridCliff, sandW * 0.75);
    float topBlend = smoothstep(0.55, 0.95, n.y);
    cliff = mix(cliff, pal * 0.75, topBlend * 0.3);
    float wallAO = smoothstep(-0.4, 0.9, wp.y) * 0.25 + 0.72;
    cliff *= wallAO;
    // Shore faces read as a sand bank, not rock or a pale skirt.
    float shoreW = smoothstep(0.10, 0.45, gWaterW);
    vec3 shoreSand = mix(vec3(0.70, 0.60, 0.40), vec3(0.90, 0.83, 0.62), clamp(wp.y * 1.8, 0.0, 1.0));
    albedo = mix(cliff, shoreSand, shoreW);
    albedo *= 0.90 + 0.20 * fbm2(p * 1.6 + 3.0);
  }

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

    // Per-crown tint variation — individual trees differ, one flat green does not
    vec2 crownCell = floor(p * 1.2);
    float crownA = hash21(crownCell);
    float crownB = hash21(crownCell + 31.7);
    canopyCol *= 0.84 + 0.32 * (crownA * (1.0 - farLod) + 0.5 * farLod);
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

    // Near LOD: trunk suggestion (jittered so it doesn't read as a grid)
    if (farLod < 0.88) {
      vec2 cell = floor(p * 2.3);
      float trunkHash = hash21(cell);
      vec2 local = fract(p * 2.3) - 0.5;
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

    // Surf: broken patches about half a step offshore, width driven by noise, so
    // it reads as breaking water instead of a rim drawn along the coast.
    float surfN = fbm2(p * 1.7 + 9.0);
    float surfBand = 1.0 - smoothstep(0.015, 0.030 + 0.045 * surfN, abs(sdW - (0.055 + 0.05 * surfN)));
    surfBand *= smoothstep(0.45, 0.80, fbm2(p * 2.6 + uTime * 0.04));
    albedo = mix(albedo, vec3(0.74, 0.86, 0.88), clamp(surfBand, 0.0, 1.0) * waterMask * 0.30);

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
      float ripple = mix(0.05, 0.11, 1.0 - smoothstep(0.05, 0.5, gShoreW)) * wWaterN;
      n = normalize(n + vec3(tn.x, 0.0, tn.y) * ripple);
    } else {
      float wx = fbm2(vWorldPos.xz * 2.8 + uTime * 0.4);
      float wz = fbm2(vWorldPos.xz * 2.8 + 17.0 - uTime * 0.34);
      n = normalize(n + vec3((wx - 0.5) * 0.4, 0.0, (wz - 0.5) * 0.4) * wWaterN);
    }
    float wSandN = smoothstep(0.25, 0.45, gSandW) * (1.0 - step(0.5, vFaceKind));
    float rip = sin(dot(vWorldPos.xz, normalize(vec2(1.2, 0.4))) * 11.0 + fbm2(vWorldPos.xz * 2.0) * 2.5);
    n = normalize(n + vec3(rip * 0.05, 0.0, rip * 0.03) * wSandN);
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

  // Base diffuse — stronger sun, weaker ambient (form definition)
  vec3 lit = albedo * (hemi * 0.32 + sunCol * ndl * 1.55 + sunCol * wrap * 0.09);

  // Vertical faces have little sky exposure; without this they read as black
  // holes between hexes instead of rock walls.
  float wallLift = 1.0 - clamp(n.y, 0.0, 1.0);
  lit += albedo * mix(uGroundAmbient, uSkyColor, 0.08) * wallLift * 0.06;
  lit += albedo * sunCol * wrap * wallLift * 0.18;

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
  vec3 shTint = mix(vec3(0.12, 0.16, 0.10), vec3(0.12, 0.11, 0.14), clamp(gMtnW + wallLift, 0.0, 1.0));
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

    float wWall = step(0.5, vFaceKind);
    float specW = pow(max(dot(n, H), 0.0), 40.0);
    lit += vec3(0.35, 0.33, 0.30) * specW * 0.08 * wWall;

    float wPlain = (1.0 - wWater) * (1.0 - wTundra) * (1.0 - wWall);
    float specP = pow(max(dot(n, H), 0.0), 16.0);
    lit += sunCol * specP * 0.03 * wPlain;
  }

  {
    float wForest = smoothstep(0.22, 0.44, gForestW) * (1.0 - step(0.5, vFaceKind));
    lit += vec3(0.4, 0.56, 0.24) * pow(fre, 4.0) * canopyOcc * 0.16 * wForest;
  }

  // Atmospheric fog — lighter, height-aware
  if (uEnableFog > 0.5) {
    float density = 0.018;
    vec3 fogCol = mix(uHorizonColor * 0.9, uSkyColor, 0.5);
    fogCol = mix(fogCol, vec3(0.88, 0.78, 0.60), 0.3 * gSandW);
    fogCol = mix(fogCol, vec3(0.45, 0.62, 0.78), 0.3 * gWaterW);
    float heightAtten = mix(1.15, 0.40, clamp(vWorldPos.y / 3.0, 0.0, 1.0));
    lit = fogExtinct(lit, fogCol, camDist * heightAtten, density);
    float farFade = smoothstep(36.0, 120.0, camDist);
    lit = mix(lit, fogCol, farFade * 0.3);
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

  gl_FragColor = vec4(lit, 1.0);
}
