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
varying float vFaceKind;
varying float vHeightAO;

/*__NOISE__*/

void main() {
  vec3 pos = position;
  float tid = terrainId;
  float fid = featureId;
  float faceKind = 1.0 - step(0.35, abs(normal.y));

  // Continuous micro-relief on land tops (soften flat hex plateaus)
  if (faceKind < 0.5 && tid < 5.5) {
    vec3 fd = fbmdX(pos.xz * 1.15 + elev * 2.0);
    float micro = (fd.x - 0.45) * 0.12;
    // Cliff boost via smoothstep on elev (Humankind terrace walls read)
    float cliffBoost = smoothstep(0.35, 0.85, elev) * 0.22;
    float landAmp = tid > 3.5 ? 1.0 : 0.55;
    if (uEnableDisplace > 0.5) {
      pos.y += (micro * landAmp + cliffBoost * elev) * uElevScale * 0.65;
    } else {
      pos.y += micro * 0.04 * uElevScale;
    }
  }

  // Mountains / hills: ridged FBM displacement
  if (uEnableDisplace > 0.5 && faceKind < 0.5 && tid > 3.5 && tid < 5.5) {
    float n = fbm(pos.xz * 1.8 + elev * 3.0);
    float ridge = ridgeFbm(pos.xz * 1.2 + elev);
    float strength = tid > 4.5 ? 0.85 : 0.38;
    float bump = (n - 0.32) * 0.7 + (ridge - 0.4) * 0.65;
    // Extra peak spike on mountains
    float peak = tid > 4.5 ? pow(max(elev - 0.5, 0.0), 1.4) * ridge * 0.55 : 0.0;
    pos.y += (bump * strength * elev + peak) * uElevScale;
  }

  // Soft terrace quantization hint (Humankind) — only on elevated land
  if (faceKind < 0.5 && tid < 5.5 && elev > 0.28) {
    float steps = floor(elev * 5.0) / 5.0;
    float terrace = (steps - elev * 0.12) * 0.05;
    pos.y += terrace * uElevScale * smoothstep(0.25, 0.55, elev);
  }

  // Water waves
  if (tid > 5.5 && faceKind < 0.5) {
    float w1 = sin(pos.x * 2.4 + uTime * 1.3) * cos(pos.z * 1.7 + uTime * 0.9);
    float w2 = sin(pos.x * 4.1 - uTime * 1.8 + pos.z * 3.2) * 0.35;
    float w3 = sin(pos.x * 1.1 + pos.z * 2.2 + uTime * 0.55) * 0.5;
    float amp = tid > 6.5 ? 0.04 : 0.065;
    pos.y += (w1 * 0.45 + w2 + w3 * 0.25) * amp;
  }

  // Forest canopy sway + slight lift
  if (fid > 0.5 && fid < 2.5 && faceKind < 0.5) {
    float canopy = canopyField(pos.xz, uTime);
    pos.y += canopy * 0.08 * (1.0 - elev * 0.3);
    float sway = sin(uTime * 1.15 + pos.x * 2.0 + pos.z * 1.4) * 0.028;
    float gust = sin(uTime * 0.35 + fbm2(pos.xz) * 6.0) * 0.012;
    pos.x += (sway + gust) * (1.0 - elev * 0.5);
    pos.z += cos(uTime * 0.9 + pos.z * 1.7) * 0.014 * (1.0 - elev * 0.5);
  }

  // Fake height-based AO factor for frag (higher = more occluded near low neighbors)
  float heightAO = 1.0 - smoothstep(0.0, 0.9, elev) * 0.15;
  if (faceKind > 0.5) heightAO *= 0.72 + 0.28 * smoothstep(-0.3, 0.8, pos.y);

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
  vHeightAO = heightAO;

  gl_Position = worldViewProjection * vec4(pos, 1.0);
}
