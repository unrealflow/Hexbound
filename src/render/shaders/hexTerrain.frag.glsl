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
uniform sampler2D uMapTex2;
uniform vec2 uMapOrigin;
uniform vec2 uMapSize;
uniform float uHexSize;
// P2 lightmap (look-workflow): sun-visibility gate strength, baked-AO
// strength, and how far shadows tint toward cool sky light.
uniform float uShadowK;
uniform float uAOK;
uniform float uShadowCool;
// P3 grade (look-workflow): applied BEFORE tonemap — exposure, saturation,
// warm-highlight/cool-shadow split. Narkowicz already sits in tonemapFilmic;
// what was missing is the grade in front of it.
uniform float uExposure;
uniform float uSaturation;
uniform float uSplitWarm;

float gWaterW;
float gForestW;
float gShoreW;
float gReliefW;
float gElevW;
float gSandW;
float gTundraW;
float gMtnW;
float gFidW;
/** P2 lightmap: baked sun visibility (ray-marched) and horizon AO. */
float gSunVis = 1.0;
float gBakeAO = 1.0;
/** Shore SDF water coverage — main() flattens normals / kills shelf needles with this. */
float gWaterSurf = 0.0;
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

  vec3 rockDark = vec3(72.0, 62.0, 52.0) / 255.0;
  vec3 rockOchre = vec3(168.0, 118.0, 72.0) / 255.0;
  vec3 rockLite = vec3(178.0, 158.0, 122.0) / 255.0;
  vec3 rockBrick = vec3(148.0, 78.0, 52.0) / 255.0;

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
  // Civ6/Humankind warm layered land: golden plains, lime grass, ochre dry.
  vec3 plains = mix(vec3(0.42, 0.52, 0.16), vec3(0.66, 0.68, 0.26), 0.25 + m * 0.55);
  plains = mix(plains, vec3(0.72, 0.58, 0.28), (1.0 - m) * 0.50);
  vec3 grass = mix(vec3(0.14, 0.32, 0.08), vec3(0.28, 0.52, 0.14), 0.28 + m * 0.55);
  grass = mix(grass, vec3(0.46, 0.66, 0.20), smoothstep(0.40, 0.9, m) * 0.65);
  vec3 sand = mix(vec3(0.80, 0.60, 0.32), vec3(0.96, 0.84, 0.54), e * 0.45);
  vec3 tundra = mix(vec3(0.40, 0.44, 0.40), vec3(0.62, 0.70, 0.72), 0.35 + e * 0.4);
  vec3 hills = mix(grass, vec3(0.52, 0.38, 0.22), 0.34);
  vec3 rock = mix(vec3(0.26, 0.23, 0.20), vec3(0.46, 0.44, 0.42), e);
  vec3 water = vec3(0.16, 0.52, 0.62);
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
  // The lightmap is positional: sample it UNWARPED so shadows and AO track
  // world positions instead of riding the biome-outline warp.
  vec2 uvL = (axialP - uMapOrigin + 0.5) / max(uMapSize, vec2(1.0));
  vec4 t2 = texture2D(uMapTex2, uvL);
  gSunVis = t2.r;
  gBakeAO = t2.g;

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
    // Never apply land displacement normals on water — elev bleed near the shelf
    // tilted gReliefNrm and, with specular, painted diagonal white needles.
    float seaKill = 1.0 - smoothstep(-0.15, 0.05, sdW);
    float landWf = smoothstep(0.02, 0.09, elevW) * seaKill;
    float dHx = 0.0;
    float dHz = 0.0;
    vec3 md = fbm2d(p * 1.1);
    float mMicro = 0.12 * mix(0.55, 0.40, mtnW) * uElevScale * 0.7;
    dHx += md.y * 1.1 * mMicro * landWf;
    dHz += md.z * 1.1 * mMicro * landWf;
    vec2 rp = mat2(0.866, 0.5, -0.5, 0.866) * p;
    vec3 rd = ridgeFbmd(rp * vec2(0.22, 0.78));
    float mRidge = 0.78 * mtnW * uElevScale * seaKill;
    dHx += (rd.y * 0.22 * 0.866 + rd.z * 0.78 * 0.5) * mRidge;
    dHz += (-rd.y * 0.22 * 0.5 + rd.z * 0.78 * 0.866) * mRidge;
    vec3 rd2 = ridgeFbmd(rp * vec2(0.55, 1.35) + vec2(2.1, -1.3));
    float mCrest = 0.26 * mtnW * uElevScale * seaKill;
    dHx += (rd2.y * 0.55 * 0.866 + rd2.z * 1.35 * 0.5) * mCrest;
    dHz += (-rd2.y * 0.55 * 0.5 + rd2.z * 1.35 * 0.866) * mCrest;
    vec3 nd = fbm2d(p * 0.55);
    float mDet = 0.07 * mtnW * uElevScale * seaKill;
    dHx += nd.y * 0.55 * mDet;
    dHz += nd.z * 0.55 * mDet;
    vec3 relief = normalize(vec3(-dHx * 0.85, 1.0, -dHz * 0.85));
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
  // Gentle low-freq shore warp only — high-freq terms read as coastal wrinkles.
  float coastN = (fbm2(p * 0.18 + 21.0) - 0.5) * 0.06;
  float waterMask = smoothstep(-0.11, 0.11, sdW + coastN);
  gWaterSurf = waterMask;
  // One continuous switch, so no medium boundary is ever drawn as a line.
  vec3 pal = mix(palLand, palWater, waterMask);

  vec3 albedo = pal;
  // Land-only mottle: applying warped FBM on water painted the diagonal worm
  // stripes the user circled in shallow turquoise.
  float landOnly = 1.0 - waterMask;
  albedo *= mix(1.0, 0.90 + 0.14 * mottled + 0.08 * (warpedFbm(p * 4.2, 1.1) - 0.5), landOnly);
  albedo = mix(microDetail(albedo, uGrassTex, p, 1.8, 0.10, 0.9), albedo, waterMask);
  albedo = mix(albedo, microDetail(albedo, uSandTex, p, 5.0, 0.05, 1.4), sandW * landOnly);

  vec3 soil = vec3(0.46, 0.35, 0.21);
  vec3 grassTint = mix(vec3(0.10, 0.26, 0.07), vec3(0.20, 0.44, 0.12), 0.25 + moist * 0.55);
  vec3 rock = rockStrata(wp, elev, slope);
  float crack = ridgeFbm(p * 1.1 + elev * 0.25);
  float meadow = (1.0 - slope) * (1.0 - smoothstep(0.42, 0.72, elev));
  rock = mix(rock, mix(grassTint * 0.9, soil, 0.35), meadow * 0.45);
  float alt = vWorldPos.y;
  float altNorm = smoothstep(1.4, 3.1, alt);
  rock = mix(rock * vec3(1.04, 1.0, 0.94), rock * vec3(0.94, 0.96, 1.0), altNorm * 0.6);
  // Dark mid rock + lit snow: high contrast snow line (Civ6 peaks).
  rock *= mix(1.0, 0.58, smoothstep(1.4, 3.2, alt));
  rock = mix(rock, rock * vec3(0.62, 0.58, 0.55), smoothstep(0.14, 0.42, slope) * 0.72);
  float scree = smoothstep(0.45, 0.15, crack);
  rock = mix(rock, rock * 0.65, scree * 0.5);
  // Snow from displaced world-Y + elevW (taller ridges after spine/ridge bump).
  float snowN = (fbm2(p * 2.2 + 1.5) - 0.5) * 0.22 + (fbm2(p * 5.0 + 8.0) - 0.5) * 0.10;
  float snowH = smoothstep(1.85, 2.65, alt + snowN);
  float snowE = smoothstep(0.52, 0.78, elevW);
  float snowLine = snowH * (0.45 + 0.55 * snowE);
  // Prefer crests/plateaus; allow light snow into mild lee bowls via noise.
  snowLine *= mix(smoothstep(0.72, 0.22, slope), 1.0, 0.25 * fbm2(p * 3.1));
  snowLine *= 0.40 + 0.60 * fbm2(p * 2.6);
  float alpine = smoothstep(1.45, 2.05, alt + snowN * 0.4) * (1.0 - snowLine);
  alpine *= smoothstep(0.55, 0.18, slope);
  rock = mix(rock, mix(rock, vec3(0.68, 0.70, 0.74), 0.6), clamp(alpine, 0.0, 1.0) * 0.7);
  float snowLit = clamp(dot(gReliefNrm, normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
  vec3 snow = mix(vec3(0.88, 0.91, 0.96), vec3(1.0, 1.0, 1.0), snowLit);
  // Shadowed snow in concave relief (into bowls / lee).
  float bowl = smoothstep(0.55, 0.95, gReliefNrm.y) * (1.0 - snowLit);
  snow = mix(snow, vec3(0.72, 0.78, 0.88), bowl * 0.45);
  rock = mix(rock, snow, clamp(snowLine, 0.0, 1.0));
  albedo = mix(albedo, rock, max(mtnW * 0.85 + snowLine * 0.5, snowLine) * (1.0 - waterMask));
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
  // Humankind shelf: clear turquoise → teal → saturated navy. Wide soft ramps.
  // Tiny low-freq darkening only (no diagonal/high-contrast).
  float depth = clamp(sdW * 1.05, 0.0, 1.0);
  float bed = (fbm2(p * 0.22 + 3.0) - 0.5) * 0.025; // barely-there seafloor
  vec3 water = mix(vec3(0.18, 0.55, 0.52), vec3(0.22, 0.68, 0.62), smoothstep(0.00, 0.22, depth + bed));
  water = mix(water, vec3(0.08, 0.40, 0.55), smoothstep(0.18, 0.48, depth));
  water = mix(water, vec3(0.03, 0.12, 0.34), smoothstep(0.42, 0.88, depth));
  float topFaceW = 1.0 - step(0.5, vFaceKind);
  albedo = mix(albedo, water, waterMask * topFaceW);
  // Soft continuous foam ribbon on the SDF (HK shore stroke — not grit).
  float foam = 1.0 - smoothstep(0.012, 0.055, abs(sdW + coastN - 0.02));
  foam *= waterMask * topFaceW;
  albedo = mix(albedo, vec3(0.78, 0.88, 0.90), foam * 0.28);

  // --- Forest / rainforest canopy (Rainforest treesMap color language) ---
  // Bake already fractal-upsampled forestCover (paper G2). Light world warp only.
  float coverNoise = (fbm2(p * 0.70 + 9.0) - 0.5) * 0.28
                   + (warpedFbm(p * 0.55, 1.2) - 0.5) * 0.22;
  float coverAmt = smoothstep(0.20, 0.72, forestW + coverNoise);
  coverAmt *= smoothstep(0.16, 0.48, forestW);
  if (coverAmt > 0.02 && waterMask < 0.5 && vFaceKind < 0.5) {
    float canopy = canopyField(p, uTime) * coverAmt;
    float canopyH = canopyHeightFactor(p, uTime) * coverAmt;
    float farLod = smoothstep(16.0, 40.0, camDist);
    float isRain = smoothstep(1.2, 1.8, fid);

    // Dark understory → mid → sunlit crown (warm greens, Civ/HK clump language)
    vec3 canopyDark = mix(vec3(0.028, 0.085, 0.025), vec3(0.025, 0.08, 0.030), isRain);
    vec3 canopyMid  = mix(vec3(0.10, 0.28, 0.06), vec3(0.08, 0.24, 0.07), isRain);
    vec3 canopyHi   = mix(vec3(0.28, 0.50, 0.12), vec3(0.18, 0.42, 0.12), isRain);
    vec3 canopyWarm = mix(vec3(0.52, 0.62, 0.16), vec3(0.26, 0.46, 0.11), isRain);

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
    albedo *= mix(0.48, 1.38, cLight);

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
  // riverDist (tex1.R on land): geometry already carved deeper in mapgen;
  // shade a clear bank + water ribbon so valleys read at overview.
  float riverProx = clamp(1.0 - gShoreW, 0.0, 1.0) * (1.0 - waterMask);
  float bank = smoothstep(0.12, 0.82, riverProx);
  float ribbon = smoothstep(0.55, 0.96, riverProx);
  albedo = mix(albedo, vec3(0.14, 0.32, 0.12), bank * 0.72);
  albedo = mix(albedo, vec3(0.10, 0.34, 0.46), ribbon * 0.92);
  albedo *= 1.0 - 0.35 * ribbon;
  float riverSpec = pow(max(dot(gReliefNrm, normalize(uSunDir + normalize(uCamPos - wp))), 0.0), 22.0);
  albedo += vec3(0.18, 0.32, 0.40) * riverSpec * ribbon * 0.55;

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
    // Beach follows smooth SDF (+ tiny coastN); no mid/high-freq shore scrapes.
    float s = sdW + coastN;
    float wet = smoothstep(-0.42, -0.02, s) * (1.0 - smoothstep(-0.02, 0.08, s));
    wet *= (1.0 - waterMask);
    albedo = mix(albedo, vec3(0.74, 0.60, 0.42), wet * 0.55);
    float dry = smoothstep(-0.95, -0.32, s) * (1.0 - smoothstep(-0.36, -0.06, s));
    dry *= (1.0 - waterMask);
    albedo = mix(albedo, vec3(0.90, 0.78, 0.58), dry * 0.34);

    // Foam/surf disabled — white grit on turquoise was part of the ugly shallow look.
  }

  // Land-only regional tint; never modulate water (FBM on shelf = worm stripes).
  float broad = fbm2(p * 0.32 + 7.0);
  float landTint = 1.0 - waterMask;
  albedo *= mix(1.0, 0.90 + 0.20 * broad, landTint);
  albedo *= mix(1.0, 0.96 + 0.07 * regional, landTint);
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
  n = gReliefNrm;

  // Land-only micro-normals. Water must not inherit sand/canopy/relief tilt.
  float landN = 1.0 - smoothstep(0.12, 0.45, gWaterSurf);
  {
    float wSandN = smoothstep(0.25, 0.45, gSandW) * (1.0 - step(0.5, vFaceKind)) * landN;
    float duneMask = smoothstep(0.35, 0.65, fbm2(vWorldPos.xz * 0.5 + 3.0));
    float rip = sin(dot(vWorldPos.xz, normalize(vec2(1.2, 0.4))) * 11.0 + fbm2(vWorldPos.xz * 2.0) * 2.5);
    n = normalize(n + vec3(rip * 0.018, 0.0, rip * 0.011) * wSandN * duneMask);
    float wForestN = smoothstep(0.22, 0.44, gForestW) * (1.0 - step(0.5, vFaceKind)) * landN;
    float c = canopyField(vWorldPos.xz, uTime) * wForestN;
    n = normalize(n + vec3((c - 0.5) * 0.45, 0.2 + c * 0.2, (fbm2(vWorldPos.zx * 2.4) - 0.5) * 0.35) * wForestN);
  }
  // HARD flatten water normals → calm mirror shelf (kills diagonal white needles).
  // uWaterNormalTex amp = 0 on the shelf; deep water gets a whisper only.
  float wFlat = smoothstep(0.08, 0.42, gWaterSurf);
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), wFlat));
  {
    float deepOnly = smoothstep(0.55, 0.95, gShoreW) * wFlat;
    if (uUseDetailTex > 0.5 && deepOnly > 0.01) {
      vec2 uv1 = vWorldPos.xz * 0.03 + vec2(uTime * 0.005, 0.0);
      vec3 tn1 = texture2D(uWaterNormalTex, uv1).xyz * 2.0 - 1.0;
      n = normalize(n + vec3(tn1.x, 0.0, tn1.y) * (0.008 * deepOnly));
    }
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

  vec3 sunCol = vec3(1.42, 1.18, 0.82);
  vec3 skyAmb = uSkyColor * 0.34;
  vec3 groundAmb = uGroundAmbient * 0.78;
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

  // Land diffuse (form). Water uses a calm, almost-lambert fill — no slope AO
  // stripes from residual relief.
  float wSurf = smoothstep(0.12, 0.50, gWaterSurf);
  // Baked sun gate: shadowed ground loses its direct sun but keeps the warm
  // wrap fill at reduced strength, so the terminator stays soft.
  float sunGate = 1.0 - uShadowK * (1.0 - gSunVis);
  vec3 litLand = albedo * (hemi * 0.26 + sunCol * ndl * 1.72 * sunGate + sunCol * wrap * 0.10 * mix(0.55, 1.0, gSunVis));
  litLand += albedo * sunCol * back * mix(0.05, 0.16, isCanopy);
  if (canopyT > 0.0) {
    vec3 transCol = mix(vec3(0.30, 0.54, 0.14), vec3(0.20, 0.46, 0.12), smoothstep(1.2, 1.8, gFidW));
    litLand += transCol * sunCol * canopyT * 0.45;
  }
  float ao = 1.0 - smoothstep(0.0, 0.9, gElevW) * 0.14 - gReliefW * 0.10;
  ao *= 1.0 - uAOK * (1.0 - gBakeAO);
  ao *= mix(1.0, canopyOcc * 0.85 + 0.15, isCanopy);
  ao *= mix(0.66, 1.0, ndl * 0.5 + 0.5);
  float slopeShade = mix(0.62, 1.0, wrap);
  litLand *= ao * slopeShade;
  vec3 shTint = mix(vec3(0.12, 0.16, 0.10), vec3(0.12, 0.11, 0.14), clamp(gMtnW, 0.0, 1.0));
  litLand = max(litLand, albedo * shTint);
  float cliffContact = (1.0 - clamp(n.y, 0.0, 1.0)) * gReliefW;
  litLand *= mix(1.0, 0.84, cliffContact * 0.55);
  // Shadowed faces read cool (sky fill dominates), sunlit faces stay warm.
  float shW = (1.0 - gSunVis) * uShadowCool;
  litLand = mix(litLand, litLand * vec3(0.80, 0.90, 1.22), shW);

  // Calm water fill (HK glass shelf): stable ndl from flat n, no AO grit.
  float ndlW = max(dot(vec3(0.0, 1.0, 0.0), L), 0.0);
  vec3 litWater = albedo * (hemi * 0.42 + sunCol * ndlW * 0.95 + sunCol * 0.12);

  vec3 lit = mix(litLand, litWater, wSurf);

  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 H = normalize(L + V);
  {
    float wWater = wSurf;
    float isDeep = smoothstep(0.45, 0.90, gShoreW);
    // Shelf: essentially no specular needles. Deep: faint broad sun sheen only.
    float spec = pow(max(dot(n, H), 0.0), 24.0);
    float sunGlare = pow(max(dot(reflect(-L, n), V), 0.0), 20.0);
    lit += vec3(0.45, 0.62, 0.78) * spec * (0.04 + 0.22 * isDeep) * wWater;
    lit += sunCol * sunGlare * (0.03 + 0.18 * isDeep) * wWater;
    vec3 skyRef = mix(uHorizonColor, uSkyColor, 0.5);
    lit = mix(lit, skyRef * 0.82, fre * fre * (0.14 + 0.16 * isDeep) * wWater);

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
    float density = 0.0042;
    vec3 fogCol = mix(uHorizonColor * 0.92, uSkyColor, 0.42);
    // Warm aerial tint near land, cool over water — avoid grey pastel veil.
    fogCol = mix(fogCol, vec3(0.90, 0.80, 0.62), 0.28 * gSandW);
    fogCol = mix(fogCol, vec3(0.42, 0.58, 0.76), 0.26 * gWaterW);
    fogCol = mix(fogCol, vec3(0.78, 0.84, 0.72), 0.12 * (1.0 - gWaterW) * (1.0 - gSandW));
    float heightAtten = mix(1.05, 0.40, clamp(vWorldPos.y / 3.0, 0.0, 1.0));
    lit = fogExtinct(lit, fogCol, camDist * heightAtten, density);
    float farFade = smoothstep(85.0, 240.0, camDist);
    lit = mix(lit, fogCol, farFade * 0.18);
  }

  if (uShowWireHint > 0.5) {
    float edge = abs(hexSDF((vUV - 0.5) * 1.72));
    float darkRim = 1.0 - smoothstep(0.0, 0.025, edge);
    lit *= 1.0 - darkRim * 0.10;
  }

  // Grade + tonemap — warmer midtones, keep contrast (no wash-white).
  lit *= 0.98;
  lit = tonemapFilmic(lit);
  lit = pow(max(lit, vec3(0.0)), vec3(0.94));
  float luma = dot(lit, vec3(0.2126, 0.7152, 0.0722));
  lit = mix(vec3(luma), lit, 1.22);
  lit = mix(lit, lit * lit * (3.0 - 2.0 * lit), 0.58);
  lit = clamp(lit, 0.0, 1.0);
  float finalLuma = dot(lit, vec3(0.299, 0.587, 0.114));
  lit = mix(lit * vec3(0.95, 0.98, 1.05), lit * vec3(1.06, 1.01, 0.94), smoothstep(0.28, 0.72, finalLuma));

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
