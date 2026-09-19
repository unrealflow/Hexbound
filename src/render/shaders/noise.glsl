// Shared procedural noise — ShaderToy-inspired (iq Rainforest / Atmospheric Landscape).
// Quintic value noise with analytical derivatives (noised / fbmdX).

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

mat2 transpose2(mat2 m) {
  return mat2(m[0][0], m[1][0], m[0][1], m[1][1]);
}

vec2 fade2(vec2 t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

vec3 fade3(vec3 t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

vec2 fade2d(vec2 t) {
  return 30.0 * t * t * (t * (t - 2.0) + 1.0);
}

// 2D value noise — (noise, dN/dx, dN/dy)
vec3 noised(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = fade2(f);
  vec2 du = fade2d(f);

  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));

  float k0 = a;
  float k1 = b - a;
  float k2 = c - a;
  float k3 = a - b - c + d;

  float n = k0 + k1 * u.x + k2 * u.y + k3 * u.x * u.y;
  return vec3(n, du.x * (k1 + k3 * u.y), du.y * (k2 + k3 * u.x));
}

float valueNoise(vec2 p) {
  return noised(p).x;
}

// 3D value noise with derivatives
vec4 noised3(vec3 x) {
  vec3 p = floor(x);
  vec3 w = fract(x);
  vec3 u = fade3(w);
  vec3 du = 30.0 * w * w * (w * (w - 2.0) + 1.0);

  float n000 = hash21(p.xy + p.z * 17.0);
  float n100 = hash21(p.xy + vec2(1.0, 0.0) + p.z * 17.0);
  float n010 = hash21(p.xy + vec2(0.0, 1.0) + p.z * 17.0);
  float n110 = hash21(p.xy + vec2(1.0, 1.0) + p.z * 17.0);
  float n001 = hash21(p.xy + (p.z + 1.0) * 17.0);
  float n101 = hash21(p.xy + vec2(1.0, 0.0) + (p.z + 1.0) * 17.0);
  float n011 = hash21(p.xy + vec2(0.0, 1.0) + (p.z + 1.0) * 17.0);
  float n111 = hash21(p.xy + vec2(1.0, 1.0) + (p.z + 1.0) * 17.0);

  float a = n000;
  float b = n100 - n000;
  float c = n010 - n000;
  float e = n001 - n000;
  float d = n000 - n100 - n010 + n110;
  float f = n000 - n010 - n001 + n011;
  float g = n000 - n100 - n001 + n101;
  float h = -n000 + n100 + n010 - n110 + n001 - n101 - n011 + n111;

  float n = a + b * u.x + c * u.y + e * u.z
          + d * u.x * u.y + g * u.x * u.z + f * u.y * u.z
          + h * u.x * u.y * u.z;

  return vec4(
    n,
    du * vec3(
      b + d * u.y + g * u.z + h * u.y * u.z,
      c + d * u.x + f * u.z + h * u.x * u.z,
      e + g * u.x + f * u.y + h * u.x * u.y
    )
  );
}

// Rotate the domain once before the first octave. Every FBM below started on an
// axis-aligned value-noise lattice, whose iso-contours are rounded squares: that
// painted rectangular patches, diamond-shaped blobs and axis-aligned light/dark
// bars into the terrain. A rotation keeps the statistics and removes the axes.
mat2 fbmRotate() {
  return mat2(0.8525, 0.5227, -0.5227, 0.8525);
}

mat2 fbmRotateT() {
  return mat2(0.8525, -0.5227, 0.5227, 0.8525);
}

// Analytical FBM with derivatives (Rainforest-style fbmd)
vec3 fbmdX(vec2 x) {
  float f = 0.0;
  float a = 0.5;
  vec2 d = vec2(0.0);
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  mat2 mt = fbmRotateT();
  x = fbmRotate() * x;
  for (int i = 0; i < 4; i++) {
    vec3 n = noised(x);
    f += a * n.x;
    d += a * (mt * n.yz);
    x = m * x;
    mt = transpose2(m) * mt;
    a *= 0.5;
  }
  return vec3(f, d);
}

float fbm(vec2 p) {
  return fbmdX(p).x;
}

// 2-octave FBM. Octaves are rotated and scaled by the matrix the 4-octave
// version uses, plus one domain rotation up front so the first (dominant)
// octave is not axis aligned either.
float fbm2(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  p = fbmRotate() * p;
  for (int i = 0; i < 2; i++) {
    v += a * valueNoise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

float fbm4(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  p = fbmRotate() * p;
  for (int i = 0; i < 4; i++) {
    v += a * valueNoise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

float ridgeFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  p = fbmRotate() * p;
  for (int i = 0; i < 4; i++) {
    float n = 1.0 - abs(valueNoise(p) * 2.0 - 1.0);
    n = n * n;
    v += a * n;
    p = m * p;
    a *= 0.5;
  }
  return v;
}

// 2-octave FBM with analytic gradient: (value, d/dx, d/dy). The gradient has to
// accumulate the per-octave transform (transpose of the accumulated matrix) or
// the reconstructed normal belongs to a different field than the value it
// shades, which is what drew axis-aligned shading bars on flat ground.
vec3 fbm2d(vec2 p) {
  float v = 0.0;
  vec2 d = vec2(0.0);
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  mat2 mt = fbmRotateT();
  p = fbmRotate() * p;
  for (int i = 0; i < 2; i++) {
    vec3 n = noised(p);
    v += a * n.x;
    d += a * (mt * n.yz);
    p = m * p;
    mt = transpose2(m) * mt;
    a *= 0.5;
  }
  return vec3(v, d);
}

// Ridged (abs-noise) FBM with analytic gradient — drives relief normals.
vec3 ridgeFbmd(vec2 p) {
  float v = 0.0;
  vec2 d = vec2(0.0);
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  mat2 mt = fbmRotateT();
  p = fbmRotate() * p;
  for (int i = 0; i < 4; i++) {
    vec3 n = noised(p);
    float s = n.x * 2.0 - 1.0;
    float r = 1.0 - abs(s);
    v += a * r * r;
    // d(r^2)/dv = 2*r*(-sign(s))*2
    d += a * (-4.0 * r * sign(s)) * (mt * n.yz);
    p = m * p;
    mt = transpose2(m) * mt;
    a *= 0.5;
  }
  return vec3(v, d);
}

float worley(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float md = 1.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      vec2 r = g + o - f;
      md = min(md, dot(r, r));
    }
  }
  return sqrt(md);
}

vec2 worley2(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float md = 8.0;
  float md2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md) {
        md2 = md;
        md = d;
      } else if (d < md2) {
        md2 = d;
      }
    }
  }
  return vec2(sqrt(md), sqrt(md2));
}

float hexSDF(vec2 p) {
  p = abs(p);
  return max(p.x * 0.866025 + p.y * 0.5, p.y) - 0.5;
}

float warpedFbm(vec2 p, float strength) {
  vec2 q = vec2(fbm(p), fbm(p + vec2(5.2, 1.3)));
  return fbm(p + strength * q);
}

float softEllipsoid(vec3 p, vec3 c, vec3 r) {
  vec3 q = (p - c) / r;
  return 1.0 - smoothstep(0.72, 1.08, length(q));
}

// One octave of jittered crowns. `emptyBias` leaves a share of the lattice cells
// with no crown at all and `rScale` spreads the radii: with one similar-sized
// blob in every cell the forest reads as a regular dot print, which is exactly
// what a uniform single octave produced.
//
// Two things here keep the lattice from showing as a grid. The lattice
// coordinates are warped by a smooth field before floor(), because an unwarped
// square lattice puts the crowns on a grid aligned with the world axes. And the
// stencil is 3x3, not 2x2: a crown whose jitter carries it across a cell edge is
// only found by the cell it lands in, so the 2x2 stencil silently dropped those
// crowns and cut the canopy into axis-aligned square holes about one cell wide
// (measured from straight above: 60% of the canopy's gradient energy was on
// horizontal edges, i.e. the world-axis cell boundaries).
float canopyOctave(vec2 p, float emptyBias, float rScale) {
  vec2 warp = vec2(fbm(p * 0.37 + 5.1), fbm(p * 0.37 + 23.7)) - 0.5;
  vec2 q = p + warp * 0.9;
  vec2 cell = floor(q);
  vec2 f = fract(q);
  float dens = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(cell + g);
      float rad = (o.x - emptyBias) * rScale;
      if (rad <= 0.0) continue;
      vec2 c = g + o - f;
      float d = length(c / vec2(rad, rad * 0.92));
      dens += 1.0 - smoothstep(0.45, 1.0, d);
    }
  }
  return clamp(dens, 0.0, 1.0);
}

// Clumped canopy (Rainforest treesMap spirit, vertex-safe). Three rotated
// incommensurate octaves of blobs, gated by a clearing field two orders larger
// than a hex, so neither the blob lattice nor the clearings can line up with the
// terrain lattice.
float canopyField(vec2 xz, float t) {
  vec2 pw = xz + vec2(sin(t * 0.25 + xz.y) * 0.04, cos(t * 0.2 + xz.x) * 0.03);
  mat2 r1 = mat2(0.62, 0.78, -0.78, 0.62);
  mat2 r2 = mat2(0.17, 0.985, -0.985, 0.17);
  float a = canopyOctave(pw * 1.05, 0.44, 1.5);
  float b = canopyOctave(r1 * pw * 2.30 + vec2(7.3, 2.1), 0.56, 1.7);
  float c = canopyOctave(r2 * pw * 4.15 + vec2(2.7, 9.4), 0.74, 2.0);
  float dens = max(a, max(0.68 * b, 0.24 * c));
  float clump = smoothstep(0.30, 0.62, fbm2(xz * 0.26 + 11.0));
  dens *= 0.34 + 0.66 * clump;
  // Micro breaks crowns / understory gaps
  return clamp(dens * (0.62 + 0.52 * fbm2(pw * 3.4)), 0.0, 1.0);
}

// Height / occlusion proxy for canopy lighting
float canopyHeightFactor(vec2 xz, float t) {
  float c = canopyField(xz, t);
  return clamp(c * (0.55 + 0.45 * fbm2(xz * 1.5 + 7.0)), 0.0, 1.0);
}

// Colored extinction fog (Rainforest fog())
vec3 fogExtinct(vec3 col, vec3 fogCol, float dist, float density) {
  float f = 1.0 - exp(-dist * density);
  return mix(col, fogCol, clamp(f, 0.0, 1.0));
}

// Beer-law style chromatic extinction
vec3 fogChromatic(vec3 col, float dist, float density) {
  vec3 ext = exp(-dist * density * vec3(1.0, 1.35, 2.1));
  return col * ext + (1.0 - ext) * vec3(0.62, 0.70, 0.82);
}

// Pointy-top axial (matches src/hex/coords.ts, HEX_SIZE default 1).
vec2 worldToAxialFrac(vec2 xz, float size) {
  float inv = 1.0 / max(size, 0.0001);
  float q = (0.57735026919 * xz.x - 0.33333334 * xz.y) * inv;
  float r = (0.66666667 * xz.y) * inv;
  return vec2(q, r);
}

vec2 axialRound(vec2 fracQR) {
  float q = fracQR.x;
  float r = fracQR.y;
  float s = -q - r;
  float rq = floor(q + 0.5);
  float rr = floor(r + 0.5);
  float rs = floor(s + 0.5);
  float dq = abs(rq - q);
  float dr = abs(rr - r);
  float ds = abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return vec2(rq, rr);
}

float axialDistance(vec2 a, vec2 b) {
  return (abs(a.x - b.x) + abs(a.x + a.y - b.x - b.y) + abs(a.y - b.y)) * 0.5;
}
