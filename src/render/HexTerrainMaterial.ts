import {
  Effect,
  ShaderMaterial,
  Texture,
  Vector3,
  type Scene,
} from '@babylonjs/core';
import vertSrc from './shaders/hexTerrain.vert.glsl?raw';
import fragSrc from './shaders/hexTerrain.frag.glsl?raw';
import noiseSrc from './shaders/noise.glsl?raw';

const SHADER_NAME = 'hexTerrain';

function injectNoise(src: string): string {
  return src.replace('/*__NOISE__*/', noiseSrc);
}

let registered = false;

function ensureShaderRegistered(): void {
  if (registered) return;
  Effect.ShadersStore[`${SHADER_NAME}VertexShader`] = injectNoise(vertSrc);
  Effect.ShadersStore[`${SHADER_NAME}FragmentShader`] = injectNoise(fragSrc);
  registered = true;
}

/** Call before rebuild so updated GLSL is picked up after HMR / reseed. */
export function resetShaderRegistration(): void {
  registered = false;
}

export type HexTerrainMaterial = ShaderMaterial;

function loadTile(scene: Scene, url: string): Texture {
  const t = new Texture(url, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 4;
  return t;
}

export function createHexTerrainMaterial(scene: Scene): HexTerrainMaterial {
  ensureShaderRegistered();

  const mat = new ShaderMaterial(
    'HexTerrainMaterial',
    scene,
    { vertex: SHADER_NAME, fragment: SHADER_NAME },
    {
      attributes: [
        'position',
        'normal',
        'uv',
        'terrainId',
        'featureId',
        'elev',
        'moisture',
        'edgeMask',
        'hexCorner',
      ],
      uniforms: [
        'world',
        'worldViewProjection',
        'uTime',
        'uElevScale',
        'uEnableDisplace',
        'uSunDir',
        'uCamPos',
        'uSkyColor',
        'uHorizonColor',
        'uGroundAmbient',
        'uEnableFog',
        'uShowWireHint',
        'uUseDetailTex',
      ],
      samplers: [
        'uNoiseTex',
        'uGrassTex',
        'uRockTex',
        'uSandTex',
        'uWaterNormalTex',
        'uCanopyTex',
      ],
    },
  );

  mat.backFaceCulling = true;
  mat.setFloat('uTime', 0);
  mat.setFloat('uElevScale', 1.7);
  mat.setFloat('uEnableDisplace', 1);
  mat.setFloat('uEnableFog', 1);
  mat.setFloat('uShowWireHint', 0); // subtle / off by default — no whiteboard outlines
  mat.setFloat('uUseDetailTex', 1);
  // Explicit sun direction (points toward sun from surface → negate light ray)
  mat.setVector3('uSunDir', new Vector3(0.55, 0.78, 0.32).normalize());
  mat.setVector3('uCamPos', new Vector3(0, 28, 36));
  mat.setVector3('uSkyColor', new Vector3(0.45, 0.62, 0.88));
  mat.setVector3('uHorizonColor', new Vector3(0.72, 0.78, 0.82));
  mat.setVector3('uGroundAmbient', new Vector3(0.18, 0.15, 0.11));

  // Tiling procedural detail textures (synthesized, not photo albedos)
  mat.setTexture('uNoiseTex', loadTile(scene, '/tex/noise.png'));
  mat.setTexture('uGrassTex', loadTile(scene, '/tex/grass_detail.png'));
  mat.setTexture('uRockTex', loadTile(scene, '/tex/rock_detail.png'));
  mat.setTexture('uSandTex', loadTile(scene, '/tex/sand_detail.png'));
  mat.setTexture('uWaterNormalTex', loadTile(scene, '/tex/water_normal.png'));
  mat.setTexture('uCanopyTex', loadTile(scene, '/tex/canopy_detail.png'));

  return mat;
}

export function updateTerrainMaterial(
  mat: HexTerrainMaterial,
  time: number,
  camPos: { x: number; y: number; z: number },
  opts?: {
    enableDisplace?: boolean;
    enableFog?: boolean;
    showWireHint?: boolean;
    useDetailTex?: boolean;
  },
): void {
  mat.setFloat('uTime', time);
  mat.setVector3('uCamPos', new Vector3(camPos.x, camPos.y, camPos.z));
  if (opts?.enableDisplace !== undefined) mat.setFloat('uEnableDisplace', opts.enableDisplace ? 1 : 0);
  if (opts?.enableFog !== undefined) mat.setFloat('uEnableFog', opts.enableFog ? 1 : 0);
  if (opts?.showWireHint !== undefined) mat.setFloat('uShowWireHint', opts.showWireHint ? 1 : 0);
  if (opts?.useDetailTex !== undefined) mat.setFloat('uUseDetailTex', opts.useDetailTex ? 1 : 0);
}
