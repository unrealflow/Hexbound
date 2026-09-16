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

uniform sampler2D uNoiseTex;
uniform sampler2D uGrassTex;
uniform sampler2D uRockTex;
uniform sampler2D uSandTex;
uniform sampler2D uWaterNormalTex;
uniform sampler2D uCanopyTex;

/*__NOISE__*/

vec3 sampleDetail(sampler2D tex, vec2 xz, float scale) {
  return texture2D(tex, xz * scale).rgb;
}

vec3 rockStrata(vec3 wp, float elev) {
  vec2 p = wp.xz;
  float bands = floor(wp.y * 6.0 + fbm2(p * 1.8) * 2.2);
  float bandVar = mod(bands, 4.0) / 4.0;
  vec3 dark = vec3(0.26, 0.22, 0.20);
  vec3 mid = vec3(0.44, 0.39, 0.34);
  vec3 lite = vec3(0.58, 0.52, 0.45);
  vec3 rock = mix(dark, mid, bandVar);
  rock = mix(rock, lite, fbm(p * 4.0 + wp.y) * 0.45);
  float cracks = smoothstep(0.08, 0.02, abs(fract(wp.y * 3.2 + fbm2(p * 2.0)) - 0.5));
  rock *= 1.0 - cracks * 0.28;
  // Ridged abs-noise albedo (mountains)
  float ridge = ridgeFbm(p * 2.4 + elev);
  rock = mix(rock * 0.82, rock * 1.12, ridge);
  if (uUseDetailTex > 0.5) {
    vec3 texR = sampleDetail(uRockTex, p, 0.55);
    rock = mix(rock, rock * (0.55 + texR * 0.9), 0.55);
  }
  rock = mix(rock, vec3(0.34, 0.32, 0.30), elev * 0.18);
  return rock;
}

vec3 terrainAlbedo(float tid, float fid, float elev, float moist, vec3 wp, vec3 n, float camDist) {
  float slope = 1.0 - clamp(n.y, 0.0, 1.0);
  vec2 p = wp.xz;
  float mottled = warpedFbm(p * 2.5, 1.25);
  vec3 noiseTex = uUseDetailTex > 0.5 ? texture2D(uNoiseTex, p * 0.12).rgb : vec3(mottled);

  // Plains
  vec3 plainsCool = vec3(0.32, 0.52, 0.24);
  vec3 plainsWarm = vec3(0.55, 0.62, 0.28);
  vec3 plainsDry = vec3(0.58, 0.50, 0.30);
  vec3 plains = mix(plainsCool, plainsWarm, moist);
  plains = mix(plains, plainsDry, (1.0 - moist) * 0.5);
  plains *= 0.78 + 0.22 * mottled;
  if (uUseDetailTex > 0.5) {
    vec3 g = sampleDetail(uGrassTex, p, 0.7);
    plains = mix(plains, plains * (0.65 + g * 0.85), 0.5);
  }

  // Grassland
  vec3 grass = mix(vec3(0.14, 0.48, 0.12), vec3(0.28, 0.64, 0.16), moist);
  grass = mix(grass, vec3(0.42, 0.54, 0.20), (1.0 - moist) * 0.4);
  float grassBlade = abs(sin(p.x * 52.0 + fbm2(p * 9.0) * 5.0 + p.y * 14.0));
  grass *= 0.70 + 0.30 * grassBlade;
  grass *= 0.85 + 0.15 * fbm2(p * 6.0);
  if (uUseDetailTex > 0.5) {
    vec3 g = sampleDetail(uGrassTex, p, 1.1);
    grass = mix(grass, grass * (0.55 + g * 1.0), 0.6);
  }

  // Desert
  vec3 sandLo = vec3(0.74, 0.56, 0.30);
  vec3 sandHi = vec3(0.92, 0.76, 0.44);
  vec3 sandShadow = vec3(0.52, 0.36, 0.20);
  vec3 sand = mix(sandLo, sandHi, elev * 0.5 + mottled * 0.5);
  float rip1 = sin(dot(p, normalize(vec2(1.3, 0.35))) * 12.0 + fbm2(p * 2.5) * 4.0);
  float rip2 = sin(dot(p, normalize(vec2(-0.4, 1.1))) * 22.0 + fbm2(p * 5.0) * 2.0) * 0.45;
  float ripples = rip1 * 0.65 + rip2;
  sand = mix(sand, sandShadow, smoothstep(-0.2, 0.6, -ripples) * 0.38);
  sand *= 0.88 + 0.12 * ripples;
  if (fid > 3.5 && fid < 4.5) {
    float dune = ridgeFbm(p * 1.6);
    sand = mix(sand * 0.78, sand * 1.1, dune);
  }
  if (uUseDetailTex > 0.5) {
    vec3 s = sampleDetail(uSandTex, p, 0.65);
    sand = mix(sand, sand * (0.6 + s * 0.85), 0.55);
  }

  // Tundra / ice
  vec3 tundra = mix(vec3(0.46, 0.50, 0.48), vec3(0.72, 0.78, 0.82), 0.3 + elev * 0.45);
  tundra *= 0.9 + 0.1 * fbm2(p * 4.0);
  vec2 iceW = worley2(p * 3.8);
  float cracks = smoothstep(0.12, 0.02, iceW.y - iceW.x);
  tundra = mix(tundra, tundra * 0.55 * vec3(0.85, 0.92, 1.0), cracks * 0.65);
  float icePatch = smoothstep(0.5, 0.78, fbm(p * 2.2 + 3.0));
  tundra = mix(tundra, vec3(0.78, 0.90, 0.98), icePatch * 0.6);

  // Hills
  vec3 hills = mix(grass, vec3(0.40, 0.38, 0.30), slope * 0.75);
  hills = mix(hills, vec3(0.50, 0.46, 0.38), elev * 0.35);
  hills *= 0.88 + 0.12 * mottled;

  // Mountains — ridged rock + snow line
  vec3 rock = rockStrata(wp, elev);
  float grassMask = (1.0 - slope) * (1.0 - smoothstep(0.42, 0.82, elev));
  rock = mix(rock, mix(grass, plains, 0.35), grassMask * 0.55);
  float snowLine = smoothstep(0.45, 0.80, elev + wp.y * 0.14 - slope * 0.38);
  snowLine *= 0.6 + 0.4 * fbm(p * 3.5);
  snowLine *= smoothstep(0.12, 0.55, 1.0 - slope * 0.5);
  vec3 snow = vec3(0.92, 0.95, 0.98) * (0.92 + 0.08 * fbm2(p * 8.0));
  rock = mix(rock, snow, snowLine);

  // Water depth gradient
  float depth = tid < 6.5 ? (0.18 + 0.22 * fbm2(p * 1.5)) : (0.72 + 0.22 * fbm2(p * 1.2));
  // Shore proximity darkens shallow turquoise
  depth = mix(depth, depth * 0.55, clamp(vEdgeMask, 0.0, 1.0) * (tid < 6.5 ? 0.85 : 0.2));
  vec3 turquoise = vec3(0.12, 0.62, 0.58);
  vec3 shallow = vec3(0.08, 0.48, 0.55);
  vec3 midBlue = vec3(0.04, 0.18, 0.48);
  vec3 deep = vec3(0.01, 0.05, 0.22);
  vec3 water = mix(turquoise, shallow, smoothstep(0.0, 0.32, depth));
  water = mix(water, midBlue, smoothstep(0.28, 0.62, depth));
  water = mix(water, deep, smoothstep(0.52, 1.0, depth));
  float caust = fbm(p * 3.2 + uTime * 0.18);
  float caust2 = fbm(p * 5.5 - uTime * 0.12 + 4.0);
  water = mix(water, water * 1.4, caust * caust2 * 0.38);
  water *= 0.9 + 0.1 * (1.0 - depth);

  vec3 albedo = plains;
  if (tid < 0.5) albedo = plains;
  else if (tid < 1.5) albedo = grass;
  else if (tid < 2.5) albedo = sand;
  else if (tid < 3.5) albedo = tundra;
  else if (tid < 4.5) albedo = hills;
  else if (tid < 5.5) albedo = rock;
  else albedo = water;

  // Cliff sides
  if (vFaceKind > 0.5 && tid < 5.5) {
    vec3 cliff = rockStrata(wp, elev);
    float topBlend = smoothstep(0.0, 0.55, n.y);
    vec3 topTint = grass;
    if (tid < 0.5) topTint = plains;
    else if (tid > 1.5 && tid < 2.5) topTint = sand;
    else if (tid > 2.5 && tid < 3.5) topTint = tundra;
    cliff = mix(cliff, topTint * 0.85, topBlend * 0.35);
    float ao = smoothstep(-0.25, 0.7, wp.y);
    cliff *= 0.5 + 0.5 * ao;
    albedo = cliff;
  }

  // Forest / rainforest — soft ellipsoid canopy field
  if (fid > 0.5 && fid < 2.5 && tid < 5.5 && vFaceKind < 0.5) {
    float canopy = canopyField(p, uTime);
    float farLod = smoothstep(18.0, 42.0, camDist);
    // Far: density color only
    vec3 canopyDark = fid > 1.5 ? vec3(0.04, 0.13, 0.07) : vec3(0.06, 0.17, 0.07);
    vec3 canopyMid = fid > 1.5 ? vec3(0.08, 0.30, 0.12) : vec3(0.12, 0.36, 0.13);
    vec3 canopyHi = fid > 1.5 ? vec3(0.16, 0.46, 0.16) : vec3(0.24, 0.52, 0.18);
    vec3 canopyCol = mix(canopyDark, canopyMid, canopy);
    canopyCol = mix(canopyCol, canopyHi, fbm2(p * 5.5 + uTime * 0.15) * canopy);
    if (uUseDetailTex > 0.5) {
      vec3 ct = sampleDetail(uCanopyTex, p + vec2(uTime * 0.01, 0.0), 0.85);
      canopyCol = mix(canopyCol, canopyCol * (0.5 + ct * 1.1), 0.55);
    }
    float cover = mix(clamp(canopy * 1.15, 0.0, 1.0), canopy * 0.85 + 0.25, farLod);
    albedo = mix(albedo * 0.5, canopyCol, cover);

    // Near: dark trunks
    if (farLod < 0.85) {
      vec2 cell = floor(p * 3.4);
      float trunkHash = hash21(cell);
      vec2 local = fract(p * 3.4) - 0.5;
      local.x += (trunkHash - 0.5) * 0.28;
      float trunkDist = length(vec2(local.x * 1.9, local.y * 0.32));
      float trunkMask = smoothstep(0.11, 0.035, trunkDist) * (1.0 - canopy * 0.55);
      trunkMask *= step(0.38, trunkHash) * (1.0 - farLod);
      albedo = mix(albedo, vec3(0.14, 0.09, 0.05), trunkMask * 0.55);
    }
  }

  // Marsh
  if (fid > 2.5 && fid < 3.5 && vFaceKind < 0.5) {
    vec3 murk = vec3(0.14, 0.28, 0.20);
    vec3 murkDeep = vec3(0.08, 0.18, 0.14);
    float pads = smoothstep(0.35, 0.75, worley(p * 3.2));
    float film = fbm2(p * 6.0 + uTime * 0.05);
    albedo = mix(mix(murkDeep, murk, film), albedo * 0.55, pads * 0.7);
  }

  if (fid > 5.5 && fid < 6.5) {
    albedo = mix(albedo, vec3(0.22, 0.52, 0.26), 0.7);
  }

  // Beach rim
  if (vEdgeMask > 0.12 && tid < 5.5 && vFaceKind < 0.5) {
    vec3 beach = vec3(0.84, 0.74, 0.50);
    float shore = smoothstep(0.12, 0.95, vEdgeMask) * (0.55 + 0.45 * fbm2(p * 8.0));
    albedo = mix(albedo, beach, shore * 0.6);
  }

  // Shore foam on water
  if (tid > 5.5 && vFaceKind < 0.5) {
    float edge = abs(hexSDF((vUV - 0.5) * 1.85));
    float foamRing = smoothstep(0.14, 0.015, edge);
    float foamAmt = (tid < 6.5 ? 0.9 : 0.28) * foamRing;
    foamAmt *= 0.5 + 0.5 * sin(uTime * 2.8 + p.x * 10.0 + p.y * 6.0);
    foamAmt *= 0.65 + 0.35 * fbm2(p * 12.0 + uTime * 0.4);
    // Also foam from edgeMask-like shore (elev unused) — boost shallow
    foamAmt = max(foamAmt, (1.0 - depth) * 0.25 * (0.5 + 0.5 * fbm2(p * 9.0 + uTime)));
    albedo = mix(albedo, vec3(0.90, 0.96, 1.0), foamAmt * 0.75);
  }

  if (vEdgeMask > 0.2 && tid < 5.5 && vFaceKind < 0.5) {
    float foam = vEdgeMask * (0.4 + 0.6 * sin(uTime * 2.6 + p.x * 9.0));
    foam *= 0.5 + 0.5 * fbm2(p * 11.0);
    float rim = smoothstep(0.1, 0.0, abs(hexSDF((vUV - 0.5) * 1.7)));
    albedo = mix(albedo, vec3(0.85, 0.90, 0.92), foam * rim * 0.28);
  }

  // Micro contrast from noise tex
  albedo *= 0.92 + 0.08 * noiseTex.g;

  return albedo;
}

void main() {
  vec3 n = normalize(vNormal);
  float camDist = length(uCamPos - vWorldPos);

  // Animated normals
  if (vTerrainId > 5.5 && vFaceKind < 0.5) {
    if (uUseDetailTex > 0.5) {
      vec2 uv1 = vWorldPos.xz * 0.35 + vec2(uTime * 0.03, uTime * 0.02);
      vec2 uv2 = vWorldPos.xz * 0.55 - vec2(uTime * 0.025, -uTime * 0.018);
      vec3 tn1 = texture2D(uWaterNormalTex, uv1).xyz * 2.0 - 1.0;
      vec3 tn2 = texture2D(uWaterNormalTex, uv2).xyz * 2.0 - 1.0;
      vec3 tn = normalize(tn1 + tn2);
      n = normalize(n + vec3(tn.x, 0.0, tn.y) * 0.55);
    } else {
      float wx = fbm(vWorldPos.xz * 3.5 + uTime * 0.45);
      float wz = fbm(vWorldPos.xz * 3.5 + 17.0 - uTime * 0.38);
      n = normalize(n + vec3((wx - 0.5) * 0.55, 0.0, (wz - 0.5) * 0.55));
    }
  } else if (vTerrainId > 4.5 && vFaceKind < 0.5) {
    vec3 fd = fbmdX(vWorldPos.xz * 5.0);
    n = normalize(n + vec3(fd.y, 0.0, fd.z) * 0.28);
  } else if (vTerrainId > 1.5 && vTerrainId < 2.5 && vFaceKind < 0.5) {
    float rip = sin(dot(vWorldPos.xz, normalize(vec2(1.2, 0.4))) * 14.0 + fbm2(vWorldPos.xz * 3.0) * 3.0);
    n = normalize(n + vec3(rip * 0.2, 0.0, rip * 0.1));
  } else if (vFeatureId > 0.5 && vFeatureId < 2.5 && vFaceKind < 0.5) {
    float c = canopyField(vWorldPos.xz, uTime);
    n = normalize(n + vec3((c - 0.5) * 0.4, 0.2, (fbm2(vWorldPos.zx * 3.0) - 0.5) * 0.35));
  }

  vec3 albedo = terrainAlbedo(vTerrainId, vFeatureId, vElev, vMoisture, vWorldPos, n, camDist);

  // Lighting: sun + hemisphere + wrap/back + Fresnel
  vec3 L = normalize(uSunDir);
  float ndl = max(dot(n, L), 0.0);
  float wrap = max(dot(n, L) * 0.5 + 0.5, 0.0);
  float back = max(dot(n, -L), 0.0) * 0.18;
  vec3 hemi = mix(uGroundAmbient, uSkyColor, n.y * 0.5 + 0.5);
  vec3 sunCol = vec3(1.0, 0.94, 0.82);
  vec3 lit = albedo * (hemi * 0.32 + sunCol * ndl * 0.95 + sunCol * wrap * 0.12 + sunCol * back);

  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 H = normalize(L + V);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  lit += albedo * fres * 0.08;

  if (vTerrainId > 5.5) {
    float spec = pow(max(dot(n, H), 0.0), 96.0);
    float spec2 = pow(max(dot(n, H), 0.0), 22.0);
    // Specular sun glint
    float sunGlare = pow(max(dot(reflect(-L, n), V), 0.0), 48.0);
    lit += vec3(0.65, 0.82, 0.95) * spec * 0.9;
    lit += vec3(0.4, 0.55, 0.7) * spec2 * 0.22;
    lit += sunCol * sunGlare * 0.55;
    lit = mix(lit, mix(uHorizonColor, uSkyColor, 0.5), fres * 0.55);
  } else if (vTerrainId > 2.5 && vTerrainId < 3.6) {
    float spec = pow(max(dot(n, H), 0.0), 48.0);
    lit += vec3(0.7, 0.85, 1.0) * spec * 0.4 * fres;
  } else if (vFaceKind > 0.5) {
    float spec = pow(max(dot(n, H), 0.0), 36.0);
    lit += vec3(0.42, 0.40, 0.36) * spec * 0.18;
  }

  // Height-based fake AO / terrain shadow
  float ao = vHeightAO;
  ao *= mix(0.78, 1.0, ndl * 0.5 + 0.5);
  // Self-shadow from slope facing away from sun
  float slopeShade = mix(0.72, 1.0, wrap);
  lit *= ao * slopeShade;

  // Soft contact AO near hex edges
  float edgeSDF = abs(hexSDF((vUV - 0.5) * 1.65));
  float contactAO = mix(0.94, 1.0, smoothstep(0.0, 0.14, edgeSDF));
  if (vFaceKind > 0.5) contactAO *= 0.82;
  lit *= contactAO;

  // Distance fog with colored extinction (Rainforest fog)
  if (uEnableFog > 0.5) {
    float density = 0.028;
    vec3 fogCol = mix(uHorizonColor, uSkyColor, 0.45);
    // Warm desert haze
    if (vTerrainId > 1.5 && vTerrainId < 2.5) {
      fogCol = mix(fogCol, vec3(0.82, 0.72, 0.55), 0.4);
    }
    // Cool over water
    if (vTerrainId > 5.5) {
      fogCol = mix(fogCol, vec3(0.55, 0.68, 0.82), 0.35);
    }
    lit = fogExtinct(lit, fogCol, camDist, density);
    // Extra far fade
    float farFade = smoothstep(36.0, 95.0, camDist);
    lit = mix(lit, fogCol, farFade * 0.35);
  }

  // Hex edges — thin, dark, subtle (optional)
  if (uShowWireHint > 0.5) {
    float edge = abs(hexSDF((vUV - 0.5) * 1.72));
    float darkRim = 1.0 - smoothstep(0.0, 0.028, edge);
    lit *= 1.0 - darkRim * 0.16;
  }

  // Mild tonemap
  lit = lit / (lit + vec3(0.92)) * 1.28;
  lit = pow(max(lit, vec3(0.0)), vec3(0.88));
  // mild saturation lift
  float luma = dot(lit, vec3(0.299, 0.587, 0.114));
  lit = mix(vec3(luma), lit, 1.18);

  gl_FragColor = vec4(lit, 1.0);
}
