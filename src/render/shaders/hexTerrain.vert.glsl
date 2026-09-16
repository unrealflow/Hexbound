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
varying float vFaceKind; // 0=top, 1=cliff side

// --- noise include injected by TS ---
/*__NOISE__*/

void main() {
  vec3 pos = position;
  float tid = terrainId;
  float fid = featureId;

  // faceKind: 1 when |ny| < 0.35 (cliff side), else 0 (top)
  float faceKind = 1.0 - step(0.35, abs(normal.y));

  // Mountain / hill vertex displacement (procedural, no heightmap texture)
  if (uEnableDisplace > 0.5 && faceKind < 0.5 && (tid > 3.5 && tid < 5.5)) {
    float n = fbm(pos.xz * 1.8 + elev * 3.0);
    float ridge = ridgeFbm(pos.xz * 1.2 + elev);
    float strength = tid > 4.5 ? 0.72 : 0.28;
    float bump = (n - 0.32) * 0.65 + (ridge - 0.4) * 0.55;
    pos.y += bump * strength * elev * uElevScale;
  }

  // Terrace micro-step on elevated land tops (Humankind tier hint)
  if (faceKind < 0.5 && tid < 5.5 && elev > 0.25) {
    float steps = floor(elev * 4.0) / 4.0;
    pos.y += (steps - elev * 0.15) * 0.04 * uElevScale;
  }

  // Water wave height
  if (tid > 5.5 && faceKind < 0.5) {
    float w1 = sin(pos.x * 2.4 + uTime * 1.3) * cos(pos.z * 1.7 + uTime * 0.9);
    float w2 = sin(pos.x * 4.1 - uTime * 1.8 + pos.z * 3.2) * 0.35;
    float w3 = sin(pos.x * 1.1 + pos.z * 2.2 + uTime * 0.55) * 0.5;
    float amp = tid > 6.5 ? 0.035 : 0.055;
    pos.y += (w1 * 0.45 + w2 + w3 * 0.25) * amp;
  }

  // Soft canopy / grass sway hint
  if (fid > 0.5 && fid < 2.5 && faceKind < 0.5) {
    float sway = sin(uTime * 1.15 + pos.x * 2.0 + pos.z * 1.4) * 0.022;
    float gust = sin(uTime * 0.35 + fbm2(pos.xz) * 6.0) * 0.01;
    pos.x += (sway + gust) * (1.0 - elev * 0.5);
    pos.z += cos(uTime * 0.9 + pos.z * 1.7) * 0.012 * (1.0 - elev * 0.5);
  }

  vec4 worldPos4 = world * vec4(pos, 1.0);
  vWorldPos = worldPos4.xyz;
  vNormal = normalize(mat3(world) * normal);
  vUV = uv;
  vTerrainId = tid;
  vFeatureId = fid;
  vElev = elev;
  vMoisture = moisture;
  vEdgeMask = edgeMask;
  vHexCorner = hexCorner;
  vFaceKind = faceKind;

  gl_Position = worldViewProjection * vec4(pos, 1.0);
}
