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
attribute float mountainW;
attribute float forestW;
attribute float dispW;

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

  // Displacement weights. Two properties make them identical on every vertex
  // the mesher emits at one world position, which is what keeps the surface
  // watertight once this shader has run:
  //  * they do not depend on the face kind. A side wall's top edge is welded to
  //    the upper terrace rim and its bottom edge to the lower one, so a wall
  //    vertex has to move exactly like the rim vertex it coincides with. Gating
  //    on "top face" left the wall edge at its CPU height, up to a world unit
  //    below the rim it was supposed to meet, and that slit showed the sky.
  //  * they are scaled by dispW, a position-only attribute that is 0 as soon as
  //    one of the cells meeting at that position is water. The land copy and the
  //    water copy of a coastal corner then displace by the same amount (zero)
  //    instead of splitting apart.
  float landMask = step(0.04, elev);
  float landW = smoothstep(0.02, 0.09, elev) * dispW;
  float mtnW = smoothstep(0.0, 0.14, mountainW) * dispW;
  float forestWv = smoothstep(0.0, 0.16, forestW) * dispW;

  // Continuous micro-relief on land tops (xz domain; welded amps)
  if (landMask > 0.5) {
    vec3 md = fbm2d(pos.xz * 1.1);
    float landAmp = mix(0.55, 0.85, mountainW);
    float cliffBoost = smoothstep(0.35, 0.85, elev) * 0.26;
    if (uEnableDisplace > 0.5) {
      pos.y += ((md.x - 0.45) * 0.14 * landAmp + cliffBoost * elev) * uElevScale * 0.7 * landW;
    } else {
      pos.y += (md.x - 0.45) * 0.04 * uElevScale * landW;
    }
  }

  // Mountains: low-frequency ridge along the spine (not per-hex lumps). The
  // ridge domain is anisotropic — stretched along a fixed 30° direction — so
  // octaves come out as elongated ranges instead of isotropic worm bumps. The
  // CPU replica (terrainContinuity.displaceLandY) and the fragment relief
  // normal must use the same constants.
  if (uEnableDisplace > 0.5) {
    vec2 rp = mat2(0.866, 0.5, -0.5, 0.866) * pos.xz;
    vec3 rd = ridgeFbmd(rp * vec2(0.32, 0.55));
    float ridgeAmp = 0.48 * mtnW * uElevScale;
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
  // (The wall branch is gone with the cliff-wall mechanism: every face is a top.)
  float heightAO = 1.0;

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

  gl_Position = worldViewProjection * vec4(pos, 1.0);
}
