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

uniform float uTime;
uniform vec3 uLightDir;
uniform vec3 uCamPos;
uniform vec3 uSkyColor;
uniform vec3 uGroundAmbient;
uniform float uEnableFog;
uniform float uShowWireHint;

// --- noise include injected by TS ---
/*__NOISE__*/

vec3 rockStrata(vec3 wp, float elev) {
  vec2 p = wp.xz;
  float bands = floor(wp.y * 5.5 + fbm2(p * 1.8) * 2.0);
  float bandVar = mod(bands, 4.0) / 4.0;
  vec3 dark = vec3(0.28, 0.24, 0.22);
  vec3 mid = vec3(0.42, 0.38, 0.34);
  vec3 lite = vec3(0.55, 0.50, 0.44);
  vec3 rock = mix(dark, mid, bandVar);
  rock = mix(rock, lite, fbm(p * 4.0 + wp.y) * 0.45);
  // Vertical cracks
  float cracks = smoothstep(0.08, 0.02, abs(fract(wp.y * 3.0 + fbm2(p * 2.0)) - 0.5));
  rock *= 1.0 - cracks * 0.25;
  rock = mix(rock, vec3(0.32, 0.30, 0.28), elev * 0.2);
  return rock;
}

vec3 terrainAlbedo(float tid, float fid, float elev, float moist, vec3 wp, vec3 n) {
  float slope = 1.0 - clamp(n.y, 0.0, 1.0);
  vec2 p = wp.xz;
  float mottled = warpedFbm(p * 2.5, 1.2);

  // --- Plains (warm-cool green bands) ---
  vec3 plainsCool = vec3(0.38, 0.50, 0.28);
  vec3 plainsWarm = vec3(0.52, 0.58, 0.30);
  vec3 plainsDry = vec3(0.58, 0.52, 0.32);
  vec3 plains = mix(plainsCool, plainsWarm, moist);
  plains = mix(plains, plainsDry, (1.0 - moist) * 0.45);
  plains *= 0.82 + 0.18 * mottled;

  // --- Grassland (richer green + grass anisotropy) ---
  vec3 grass = mix(vec3(0.18, 0.46, 0.16), vec3(0.32, 0.60, 0.20), moist);
  grass = mix(grass, vec3(0.42, 0.55, 0.22), (1.0 - moist) * 0.35);
  float grassBlade = abs(sin(p.x * 48.0 + fbm2(p * 9.0) * 5.0 + p.y * 12.0));
  grass *= 0.72 + 0.28 * grassBlade;
  grass *= 0.88 + 0.12 * fbm2(p * 6.0);

  // --- Desert / dunes ---
  vec3 sandLo = vec3(0.72, 0.56, 0.32);
  vec3 sandHi = vec3(0.90, 0.74, 0.44);
  vec3 sandShadow = vec3(0.55, 0.38, 0.22);
  vec3 sand = mix(sandLo, sandHi, elev * 0.5 + mottled * 0.5);
  // Multi-frequency dune ripples
  float rip1 = sin(dot(p, normalize(vec2(1.3, 0.35))) * 12.0 + fbm2(p * 2.5) * 4.0);
  float rip2 = sin(dot(p, normalize(vec2(-0.4, 1.1))) * 22.0 + fbm2(p * 5.0) * 2.0) * 0.45;
  float ripples = rip1 * 0.65 + rip2;
  sand = mix(sand, sandShadow, smoothstep(-0.2, 0.6, -ripples) * 0.35);
  sand *= 0.88 + 0.12 * ripples;
  if (fid > 3.5 && fid < 4.5) {
    float dune = ridgeFbm(p * 1.6);
    sand = mix(sand * 0.78, sand * 1.08, dune);
    sand = mix(sand, sandShadow, (1.0 - dune) * 0.25);
  }

  // --- Tundra / ice ---
  vec3 tundra = mix(vec3(0.48, 0.52, 0.50), vec3(0.72, 0.78, 0.82), 0.3 + elev * 0.45);
  tundra *= 0.9 + 0.1 * fbm2(p * 4.0);
  vec2 iceW = worley2(p * 3.8);
  float cracks = smoothstep(0.12, 0.02, iceW.y - iceW.x);
  tundra = mix(tundra, tundra * 0.55 * vec3(0.85, 0.92, 1.0), cracks * 0.65);
  float icePatch = smoothstep(0.5, 0.78, fbm(p * 2.2 + 3.0));
  vec3 iceCol = vec3(0.78, 0.90, 0.98);
  tundra = mix(tundra, iceCol, icePatch * 0.6);

  // --- Hills ---
  vec3 hills = mix(grass, vec3(0.40, 0.38, 0.30), slope * 0.75);
  hills = mix(hills, vec3(0.48, 0.46, 0.38), elev * 0.35);
  hills *= 0.88 + 0.12 * mottled;

  // --- Mountains ---
  vec3 rock = rockStrata(wp, elev);
  // Slope-based rock vs grass (Humankind / Civ mountain base)
  float grassMask = (1.0 - slope) * (1.0 - smoothstep(0.45, 0.85, elev));
  rock = mix(rock, mix(grass, plains, 0.35), grassMask * 0.55);
  // Snowline with broken edges
  float snowLine = smoothstep(0.48, 0.82, elev + wp.y * 0.12 - slope * 0.35);
  snowLine *= 0.65 + 0.35 * fbm(p * 3.5);
  snowLine *= smoothstep(0.15, 0.55, 1.0 - slope * 0.5);
  vec3 snow = vec3(0.90, 0.94, 0.98);
  snow *= 0.92 + 0.08 * fbm2(p * 8.0);
  rock = mix(rock, snow, snowLine);

  // --- Water depth color ---
  float depth = tid > 6.5 ? 1.0 : mix(0.25, 0.55, clamp(1.0 - moist * 0.3, 0.0, 1.0));
  // Shore proximity via edgeMask on land neighbors baked; for water use elev unused → use fake depth from fbm
  float nearShore = tid < 6.5 ? 0.7 : 0.15;
  // Actually for shallow vs deep: tid 6 vs 7
  if (tid < 6.5) depth = 0.22 + 0.2 * fbm2(p * 1.5);
  else depth = 0.75 + 0.2 * fbm2(p * 1.2);
  vec3 turquoise = vec3(0.18, 0.55, 0.52);
  vec3 shallow = vec3(0.12, 0.42, 0.50);
  vec3 midBlue = vec3(0.06, 0.22, 0.42);
  vec3 deep = vec3(0.02, 0.08, 0.22);
  vec3 water = mix(turquoise, shallow, smoothstep(0.0, 0.35, depth));
  water = mix(water, midBlue, smoothstep(0.3, 0.65, depth));
  water = mix(water, deep, smoothstep(0.55, 1.0, depth));
  // Caustics / wave pattern
  float caust = fbm(p * 3.2 + uTime * 0.18);
  float caust2 = fbm(p * 5.5 - uTime * 0.12 + 4.0);
  water = mix(water, water * 1.35, caust * caust2 * 0.35);
  // Subtle depth darkening toward open ocean
  water *= 0.92 + 0.08 * (1.0 - depth);

  // Pick base by terrainId
  vec3 albedo = plains;
  if (tid < 0.5) albedo = plains;
  else if (tid < 1.5) albedo = grass;
  else if (tid < 2.5) albedo = sand;
  else if (tid < 3.5) albedo = tundra;
  else if (tid < 4.5) albedo = hills;
  else if (tid < 5.5) albedo = rock;
  else albedo = water;

  // Cliff / side faces: rock strata over terrain (Humankind terrace walls)
  if (vFaceKind > 0.5 && tid < 5.5) {
    vec3 cliff = rockStrata(wp, elev);
    // Dry grass edge near top of cliff
    float topBlend = smoothstep(0.0, 0.55, n.y);
    vec3 topTint = mix(grass, sand, clamp(tid - 1.5, 0.0, 1.0) * 0.5);
    if (tid < 1.5) topTint = grass;
    else if (tid < 0.5) topTint = plains;
    else if (tid > 1.5 && tid < 2.5) topTint = sand;
    else if (tid > 2.5 && tid < 3.5) topTint = tundra;
    cliff = mix(cliff, topTint * 0.85, topBlend * 0.35);
    // AO darken toward base
    float ao = smoothstep(-0.2, 0.6, wp.y);
    cliff *= 0.55 + 0.45 * ao;
    albedo = cliff;
  }

  // --- Forest / rainforest canopy (dense Worley, no tree meshes) ---
  if (fid > 0.5 && fid < 2.5 && tid < 5.5 && vFaceKind < 0.5) {
    float wind = uTime * 0.35;
    vec2 canopyUV = p * 2.6 + vec2(sin(wind + p.y) * 0.08, cos(wind * 0.7) * 0.06);
    vec2 w2 = worley2(canopyUV);
    float canopy = 1.0 - w2.x;
    canopy = smoothstep(0.2, 0.88, canopy);
    float clump = smoothstep(0.15, 0.55, w2.y - w2.x);
    vec3 canopyDark = vec3(0.06, 0.18, 0.08);
    vec3 canopyMid = vec3(0.12, 0.36, 0.14);
    vec3 canopyHi = vec3(0.22, 0.50, 0.18);
    if (fid > 1.5) {
      canopyDark = vec3(0.04, 0.14, 0.08);
      canopyMid = vec3(0.08, 0.30, 0.12);
      canopyHi = vec3(0.16, 0.44, 0.16);
    }
    vec3 canopyCol = mix(canopyDark, canopyMid, canopy);
    canopyCol = mix(canopyCol, canopyHi, fbm2(p * 5.5 + wind * 0.5) * canopy * clump);
    // Gaps show darker understory / ground
    float cover = canopy * (0.75 + 0.25 * clump);
    albedo = mix(albedo * 0.55, canopyCol, cover * 0.94);
    // Near-view trunk SDF hints (dark vertical stems in gaps)
    vec2 cell = floor(p * 3.2);
    float trunkHash = hash21(cell);
    vec2 local = fract(p * 3.2) - 0.5;
    local.x += (trunkHash - 0.5) * 0.25;
    float trunkDist = length(vec2(local.x * 1.8, local.y * 0.35));
    float trunkMask = smoothstep(0.12, 0.04, trunkDist) * (1.0 - canopy * 0.65);
    trunkMask *= step(0.35, trunkHash); // sparse
    albedo = mix(albedo, vec3(0.16, 0.10, 0.06), trunkMask * 0.45);
  }

  // Marsh / swamp murk
  if (fid > 2.5 && fid < 3.5 && vFaceKind < 0.5) {
    vec3 murk = vec3(0.14, 0.28, 0.20);
    vec3 murkDeep = vec3(0.08, 0.18, 0.14);
    float pads = smoothstep(0.35, 0.75, worley(p * 3.2));
    float film = fbm2(p * 6.0 + uTime * 0.05);
    albedo = mix(mix(murkDeep, murk, film), albedo * 0.55, pads * 0.7);
    albedo = mix(albedo, vec3(0.2, 0.38, 0.22), pads * 0.25);
  }

  // Oasis
  if (fid > 5.5 && fid < 6.5) {
    albedo = mix(albedo, vec3(0.22, 0.52, 0.26), 0.7);
    float fringe = worley(p * 4.0);
    albedo = mix(albedo, vec3(0.15, 0.40, 0.22), (1.0 - fringe) * 0.3);
  }

  // Beach / shore sand rim on land next to water
  if (vEdgeMask > 0.15 && tid < 5.5 && vFaceKind < 0.5) {
    vec3 beach = vec3(0.82, 0.72, 0.48);
    float shore = smoothstep(0.15, 0.95, vEdgeMask) * (0.55 + 0.45 * fbm2(p * 8.0));
    albedo = mix(albedo, beach, shore * 0.55);
  }

  // Shore foam on water near land (edgeMask is on land; for water foam we use depth heuristic + UV edge)
  if (tid > 5.5 && vFaceKind < 0.5) {
    float edge = abs(hexSDF((vUV - 0.5) * 1.85));
    float foamRing = smoothstep(0.12, 0.02, edge);
    // Shallow water gets stronger foam
    float foamAmt = (tid < 6.5 ? 0.85 : 0.25) * foamRing;
    foamAmt *= 0.55 + 0.45 * sin(uTime * 2.8 + p.x * 10.0 + p.y * 6.0);
    foamAmt *= 0.7 + 0.3 * fbm2(p * 12.0 + uTime * 0.4);
    albedo = mix(albedo, vec3(0.88, 0.94, 1.0), foamAmt * 0.7);
  }

  // Land foam accent when edgeMask present (Civ white surf line)
  if (vEdgeMask > 0.25 && tid < 5.5 && vFaceKind < 0.5) {
    float foam = vEdgeMask * (0.45 + 0.55 * sin(uTime * 2.6 + p.x * 9.0));
    foam *= 0.55 + 0.45 * fbm2(p * 11.0);
    float rim = smoothstep(0.08, 0.0, abs(hexSDF((vUV - 0.5) * 1.7)));
    albedo = mix(albedo, vec3(0.92, 0.96, 1.0), foam * rim * 0.55);
  }

  return albedo;
}

void main() {
  vec3 n = normalize(vNormal);

  // Perturb normals for water / desert / rough rock without normal maps
  if (vTerrainId > 5.5 && vFaceKind < 0.5) {
    float wx = fbm(vWorldPos.xz * 3.5 + uTime * 0.45);
    float wz = fbm(vWorldPos.xz * 3.5 + 17.0 - uTime * 0.38);
    float wx2 = fbm(vWorldPos.xz * 7.0 - uTime * 0.6);
    n = normalize(n + vec3((wx - 0.5) * 0.55 + (wx2 - 0.5) * 0.2, 0.0, (wz - 0.5) * 0.55));
  } else if (vTerrainId > 4.5 && vFaceKind < 0.5) {
    float r = fbm(vWorldPos.xz * 6.0);
    n = normalize(n + vec3((r - 0.5) * 0.3, 0.0, (fbm(vWorldPos.zx * 6.0) - 0.5) * 0.3));
  } else if (vTerrainId > 1.5 && vTerrainId < 2.5 && vFaceKind < 0.5) {
    // Desert dune normal ripples
    float rip = sin(dot(vWorldPos.xz, normalize(vec2(1.2, 0.4))) * 14.0 + fbm2(vWorldPos.xz * 3.0) * 3.0);
    n = normalize(n + vec3(rip * 0.18, 0.0, rip * 0.08));
  } else if (vFeatureId > 0.5 && vFeatureId < 2.5 && vFaceKind < 0.5) {
    // Canopy bump
    float c = 1.0 - worley(vWorldPos.xz * 2.8 + uTime * 0.02);
    n = normalize(n + vec3((c - 0.5) * 0.35, 0.15, (fbm2(vWorldPos.zx * 3.0) - 0.5) * 0.35));
  }

  vec3 albedo = terrainAlbedo(vTerrainId, vFeatureId, vElev, vMoisture, vWorldPos, n);

  vec3 L = normalize(uLightDir);
  float ndl = max(dot(n, L), 0.0);
  // Soft wrap lighting for terrain readability
  float wrap = max(dot(n, L) * 0.5 + 0.5, 0.0);
  vec3 hemi = mix(uGroundAmbient, uSkyColor, n.y * 0.5 + 0.5);
  vec3 sunCol = vec3(1.0, 0.95, 0.85);
  vec3 lit = albedo * (hemi * 0.5 + sunCol * ndl * 0.72 + sunCol * wrap * 0.12);

  // Specular for water / ice / wet rock
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 H = normalize(L + V);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  if (vTerrainId > 5.5) {
    float spec = pow(max(dot(n, H), 0.0), 72.0);
    float spec2 = pow(max(dot(n, H), 0.0), 18.0);
    lit += vec3(0.55, 0.72, 0.90) * spec * 0.75;
    lit += vec3(0.35, 0.50, 0.65) * spec2 * 0.2;
    lit = mix(lit, uSkyColor * 0.9, fres * 0.5);
  } else if (vTerrainId > 2.5 && vTerrainId < 3.6) {
    float spec = pow(max(dot(n, H), 0.0), 48.0);
    lit += vec3(0.7, 0.85, 1.0) * spec * 0.4 * fres;
  } else if (vFaceKind > 0.5) {
    float spec = pow(max(dot(n, H), 0.0), 32.0);
    lit += vec3(0.4, 0.38, 0.35) * spec * 0.15;
  }

  // Soft contact AO near hex edges / cliff bases
  float edgeSDF = abs(hexSDF((vUV - 0.5) * 1.65));
  float contactAO = mix(0.82, 1.0, smoothstep(0.0, 0.1, edgeSDF));
  if (vFaceKind > 0.5) contactAO *= 0.85;
  lit *= contactAO;

  // Distance fog (hemisphere-tinted)
  if (uEnableFog > 0.5) {
    float dist = length(uCamPos - vWorldPos);
    float fog = smoothstep(24.0, 78.0, dist);
    fog = fog * fog;
    vec3 fogCol = mix(uSkyColor * 0.85, vec3(0.70, 0.72, 0.68), 0.25);
    // Slight warm tint over desert-ish
    if (vTerrainId > 1.5 && vTerrainId < 2.5) {
      fogCol = mix(fogCol, vec3(0.78, 0.68, 0.52), 0.35);
    }
    lit = mix(lit, fogCol, fog * 0.72);
  }

  // Hex cell borders — Civ-like subtle dark/light territory rim
  if (uShowWireHint > 0.5) {
    float edge = abs(hexSDF((vUV - 0.5) * 1.72));
    float darkRim = 1.0 - smoothstep(0.0, 0.045, edge);
    float lightRim = smoothstep(0.04, 0.075, edge) * (1.0 - smoothstep(0.075, 0.11, edge));
    lit *= 1.0 - darkRim * 0.28;
    lit += vec3(0.12, 0.14, 0.10) * lightRim * 0.35;
    // Corner accent
    if (vHexCorner >= 0.0) {
      float cornerGlow = darkRim * 0.15;
      lit += vec3(0.08, 0.10, 0.06) * cornerGlow;
    }
  }

  // Mild tonemap / contrast for Civ painterly punch
  lit = lit / (lit + vec3(0.85)) * 1.15;
  lit = pow(max(lit, vec3(0.0)), vec3(0.95));

  gl_FragColor = vec4(lit, 1.0);
}
