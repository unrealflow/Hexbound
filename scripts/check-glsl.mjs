/** Compile the composed hex-terrain GLSL in a WebGL1 context and print info logs.
 * Usage: node scripts/check-glsl.mjs
 * Catches syntax/undeclared-identifier errors without waiting on a full render.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const noise = readFileSync(join(root, 'src/render/shaders/noise.glsl'), 'utf8');
const compose = (f) =>
  readFileSync(join(root, 'src/render/shaders', f), 'utf8').replace('/*__NOISE__*/', noise);

const vert = compose('hexTerrain.vert.glsl');
const frag = compose('hexTerrain.frag.glsl');

// Babylon renders with a WebGL2 context and converts the GLSL ES 1.00 sources
// to 300 es. Compile both forms: ES 3.00 rejects reserved words (e.g. `patch`)
// that ES 1.00 accepts, so the WebGL1 check alone misses real failures.
function toES3(src, isVertex) {
  let out = src
    .replace(/\battribute\b/g, 'in')
    .replace(/\bvarying\b/g, isVertex ? 'out' : 'in')
    .replace(/\btexture2D\b/g, 'texture')
    .replace(/\bgl_FragColor\b/g, 'glFragColor');
  if (!isVertex) out = out.replace(/precision highp float;/, 'precision highp float;\nout vec4 glFragColor;');
  else out = out.replace(/gl_Position/g, 'gl_Position');
  return '#version 300 es\n' + out;
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage();
const result = await page.evaluate(
  ([v, f, v3, f3]) => {
    const canvas = document.createElement('canvas');
    const compileIn = (gl, type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return { ok: gl.getShaderParameter(sh, gl.COMPILE_STATUS), log: gl.getShaderInfoLog(sh) || '' };
    };
    const gl1 = canvas.getContext('webgl');
    const gl3 = document.createElement('canvas').getContext('webgl2');
    return {
      es1: {
        vertex: compileIn(gl1, gl1.VERTEX_SHADER, v),
        fragment: compileIn(gl1, gl1.FRAGMENT_SHADER, f),
      },
      es3: {
        vertex: compileIn(gl3, gl3.VERTEX_SHADER, v3),
        fragment: compileIn(gl3, gl3.FRAGMENT_SHADER, f3),
      },
    };
  },
  [vert, frag, toES3(vert, true), toES3(frag, false)],
);

let failures = 0;
for (const [stage, pair] of Object.entries(result)) {
  for (const [which, r] of Object.entries(pair)) {
    console.log(`${stage} ${which}: ${r.ok ? 'OK' : 'FAIL'}`);
    if (!r.ok) {
      failures++;
      if (r.log) console.log(r.log.split('\n').slice(0, 8).map((l) => '   ' + l).join('\n'));
    }
  }
}
await browser.close();
process.exitCode = failures === 0 ? 0 : 1;
