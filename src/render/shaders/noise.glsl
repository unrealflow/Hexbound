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

// Analytical FBM with derivatives (Rainforest-style fbmd)
vec3 fbmdX(vec2 x) {
  float f = 0.0;
  float a = 0.5;
  vec2 d = vec2(0.0);
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  mat2 mt = mat2(1.0, 0.0, 0.0, 1.0);
  for (int i = 0; i < 5; i++) {
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

float fbm2(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 2; i++) {
    v += a * valueNoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

float fbm4(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
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
  for (int i = 0; i < 5; i++) {
    float n = 1.0 - abs(valueNoise(p) * 2.0 - 1.0);
    n = n * n;
    v += a * n;
    p = m * p;
    a *= 0.5;
  }
  return v;
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
  return 1.0 - smoothstep(0.75, 1.05, length(q));
}

// Cell-local soft ellipsoid canopy + FBM distort (treesMap idea)
float canopyField(vec2 xz, float t) {
  float wind = t * 0.35;
  vec2 pw = xz + vec2(sin(wind + xz.y) * 0.06, cos(wind * 0.7) * 0.05);
  vec3 fd = fbmdX(pw * 0.8);
  pw += 0.12 * fd.yz;
  float dens = 0.0;
  vec2 cell = floor(pw * 1.35);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 gc = cell + vec2(float(i), float(j));
      vec2 rnd = hash22(gc);
      vec2 center = (gc + rnd) / 1.35;
      float rad = 0.32 + rnd.y * 0.38;
      dens += softEllipsoid(
        vec3(pw.x, 0.2, pw.y),
        vec3(center.x, 0.12 + rnd.x * 0.1, center.y),
        vec3(rad, 0.5, rad * 0.9)
      );
    }
  }
  dens = clamp(dens, 0.0, 1.0);
  return mix(dens, dens * (0.65 + 0.35 * fbm(pw * 3.0)), 0.45);
}

vec3 fogExtinct(vec3 col, vec3 fogCol, float dist, float density) {
  float f = 1.0 - exp(-dist * density);
  return mix(col, fogCol, clamp(f, 0.0, 1.0));
}
