import {
  Constants,
  Effect,
  RawTexture,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  type Scene,
} from '@babylonjs/core';
import vertSrc from './shaders/hexTerrain.vert.glsl?raw';
import fragSrc from './shaders/hexTerrain.frag.glsl?raw';
import noiseSrc from './shaders/noise.glsl?raw';
import { HEX_SIZE } from '../hex/coords';
import type { HexMap } from '../hex/HexMap';

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
        'shoreDist',
        'mountainW',
        'forestW',
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
        'uMapOrigin',
        'uMapSize',
        'uHexSize',
      ],
      samplers: [
        'uNoiseTex',
        'uGrassTex',
        'uRockTex',
        'uSandTex',
        'uWaterNormalTex',
        'uCanopyTex',
        'uMapTex0',
        'uMapTex1',
      ],
    },
  );

  mat.backFaceCulling = true;
  mat.setFloat('uTime', 0);
  mat.setFloat('uElevScale', 2.0);
  mat.setFloat('uEnableDisplace', 1);
  mat.setFloat('uEnableFog', 1);
  mat.setFloat('uShowWireHint', 0);
  mat.setFloat('uUseDetailTex', 1);
  // Surface-to-sun direction (matches scene light)
  mat.setVector3('uSunDir', new Vector3(0.62, 0.72, 0.3).normalize());
  mat.setVector3('uCamPos', new Vector3(0, 26, 34));
  mat.setVector3('uSkyColor', new Vector3(0.32, 0.52, 0.88));
  mat.setVector3('uHorizonColor', new Vector3(0.72, 0.78, 0.86));
  mat.setVector3('uGroundAmbient', new Vector3(0.22, 0.18, 0.12));

  // Tiling procedural detail textures (synthesized, allowed for micro-detail)
  mat.setTexture('uNoiseTex', loadTile(scene, '/tex/noise.png'));
  mat.setTexture('uGrassTex', loadTile(scene, '/tex/grass_detail.png'));
  mat.setTexture('uRockTex', loadTile(scene, '/tex/rock_detail.png'));
  mat.setTexture('uSandTex', loadTile(scene, '/tex/sand_detail.png'));
  mat.setTexture('uWaterNormalTex', loadTile(scene, '/tex/water_normal.png'));
  mat.setTexture('uCanopyTex', loadTile(scene, '/tex/canopy_detail.png'));
  mat.setVector2('uMapOrigin', new Vector2(0, 0));
  mat.setVector2('uMapSize', new Vector2(40, 32));
  mat.setFloat('uHexSize', HEX_SIZE);

  return mat;
}

function createMapDataTex(scene: Scene, data: Uint8Array, width: number, height: number, name: string): RawTexture {
  const tex = new RawTexture(
    data,
    width,
    height,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
  );
  tex.name = name;
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  tex.updateSamplingMode(Texture.BILINEAR_SAMPLINGMODE);
  return tex;
}

/** Upload the two NEAREST+CLAMP map fields. Caller must dispose the returned textures. */
export function bindMapData(
  mat: HexTerrainMaterial,
  scene: Scene,
  map: HexMap,
): { tex0: RawTexture; tex1: RawTexture } {
  const { tex0, tex1 } = map.packMapTexels();
  const t0 = createMapDataTex(scene, tex0, map.width, map.height, 'uMapTex0');
  const t1 = createMapDataTex(scene, tex1, map.width, map.height, 'uMapTex1');
  mat.setTexture('uMapTex0', t0);
  mat.setTexture('uMapTex1', t1);
  mat.setVector2('uMapOrigin', new Vector2(map.originQ, map.originR));
  mat.setVector2('uMapSize', new Vector2(map.width, map.height));
  mat.setFloat('uHexSize', HEX_SIZE);
  return { tex0: t0, tex1: t1 };
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
