precision highp float;

attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute float terrainId;
attribute float featureId;
attribute float elev;
attribute float moisture;
attribute float edgeMask;
attribute float hexCorner;
attribute float shoreDist;
attribute float mountainW;
attribute float forestW;

uniform mat4 worldViewProjection;
uniform mat4 world;
uniform float uTime;
uniform float uElevScale;
uniform float uEnableDisplace;

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

/*__NOISE__*/

void main() {
  vec3 pos = position;
  float tid = terrainId;
  float fid = featureId;
  float faceKind = 1.0 - step(0.35, abs(normal.y));

  float landMask = 1.0 - step(elev, 0.04);
  // Smooth weights instead of hard branches: a per-cell attribute switched by
  // an "if" creases exactly along the cell border.
  float topFace = 1.0 - step(0.5, faceKind);
  float landW = smoothstep(0.02, 0.09, elev) * topFace;
  float mtnW = smoothstep(0.0, 0.14, mountainW) * topFace;
  float forestWv = smoothstep(0.0, 0.16, forestW) * topFace;

  // Continuous micro-relief on land tops (xz domain; welded amps)
  {
    vec3 md = fbm2d(pos.xz * 1.1);
    float landAmp = mix(0.55, 1.0, mountainW);
    float cliffBoost = smoothstep(0.35, 0.85, elev) * 0.26;
    if (uEnableDisplace > 0.5) {
      pos.y += ((md.x - 0.45) * 0.14 * landAmp + cliffBoost * elev) * uElevScale * 0.7 * landW;
    } else {
      pos.y += (md.x - 0.45) * 0.04 * uElevScale * landW;
    }
  }

  // Mountains: low-frequency ridge along the spine (not per-hex lumps)
  if (uEnableDisplace > 0.5) {
    vec3 rd = ridgeFbmd(pos.xz * 0.45);
    float ridgeAmp = 0.55 * mtnW * uElevScale;
    pos.y += (rd.x - 0.32) * ridgeAmp;
    vec3 nd = fbm2d(pos.xz * 0.55);
    pos.y += (nd.x - 0.4) * 0.12 * mtnW * uElevScale;
  }

  // Soft terrace: only low-relief mid-elev, continuous, amp <= 0.04 * uElevScale
  {
    float terraceW = smoothstep(0.32, 0.38, elev) * (1.0 - smoothstep(0.50, 0.55, elev));
    terraceW *= (1.0 - mtnW);
    pos.y += terraceW * 0.04 * uElevScale * landW;
  }

  // Water surface is flat: a 7-vertex cell can only interpolate a wave into
  // facets, which read as a honeycomb sheen. Ripples live in the fragment.
  if (landMask < 0.5 && faceKind < 0.5) {
    pos.y += 0.0;
  }

  // Forest canopy lift + wind sway from continuous forestW
  {
    // World-space patchiness: a per-cell forestW lifts a whole cell into one
    // flat plateau, which shows up as a hard hex edge at every forest border.
    float canopy = canopyField(pos.xz, uTime) * forestWv * smoothstep(0.28, 0.72, fbm2(pos.xz * 1.15 + 7.0));
    pos.y += canopy * 0.09 * (1.0 - elev * 0.25);
    float sway = sin(uTime * 1.05 + pos.x * 1.8 + pos.z * 1.3) * 0.03 * forestWv;
    float gust = sin(uTime * 0.32 + fbm2(pos.xz) * 6.0) * 0.012 * forestWv;
    pos.x += (sway + gust) * (1.0 - elev * 0.45);
    pos.z += cos(uTime * 0.85 + pos.z * 1.5) * 0.014 * forestWv * (1.0 - elev * 0.45);
  }

  // Relief normal moved to the fragment: a per-vertex gradient is constant
  // across each cell top fan, so interpolating it creased shading on hex edges.
  vec3 nrm = normalize(normal);

  // Height AO moved to the fragment (smooth mixed fields), so no per-cell line.
  float heightAO = 1.0;
  if (faceKind > 0.5) heightAO = 0.68 + 0.32 * smoothstep(-0.3, 0.8, pos.y);

  vec4 worldPos4 = world * vec4(pos, 1.0);
  vWorldPos = worldPos4.xyz;
  vNormal = normalize(mat3(world) * nrm);
  vUV = uv;
  vTerrainId = tid;
  vFeatureId = fid;
  vElev = elev;
  vMoisture = moisture;
  vEdgeMask = edgeMask;
  vHexCorner = hexCorner;
  vFaceKind = faceKind;
  vHeightAO = heightAO;
  vShoreDist = shoreDist;

  gl_Position = worldViewProjection * vec4(pos, 1.0);
}
