import { Effect, ShaderMaterial, Vector3, type Scene } from '@babylonjs/core';
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
        'uLightDir',
        'uCamPos',
        'uSkyColor',
        'uGroundAmbient',
        'uEnableFog',
        'uShowWireHint',
      ],
    },
  );

  mat.backFaceCulling = true;
  mat.setFloat('uTime', 0);
  mat.setFloat('uElevScale', 1.55);
  mat.setFloat('uEnableDisplace', 1);
  mat.setFloat('uEnableFog', 1);
  mat.setFloat('uShowWireHint', 1);
  mat.setVector3('uLightDir', new Vector3(-0.55, 0.75, -0.4).normalize());
  mat.setVector3('uCamPos', new Vector3(0, 26, 34));
  mat.setVector3('uSkyColor', new Vector3(0.52, 0.66, 0.84));
  mat.setVector3('uGroundAmbient', new Vector3(0.20, 0.16, 0.12));

  return mat;
}

export function updateTerrainMaterial(
  mat: HexTerrainMaterial,
  time: number,
  camPos: { x: number; y: number; z: number },
  opts?: { enableDisplace?: boolean; enableFog?: boolean; showWireHint?: boolean },
): void {
  mat.setFloat('uTime', time);
  mat.setVector3('uCamPos', new Vector3(camPos.x, camPos.y, camPos.z));
  if (opts?.enableDisplace !== undefined) mat.setFloat('uEnableDisplace', opts.enableDisplace ? 1 : 0);
  if (opts?.enableFog !== undefined) mat.setFloat('uEnableFog', opts.enableFog ? 1 : 0);
  if (opts?.showWireHint !== undefined) mat.setFloat('uShowWireHint', opts.showWireHint ? 1 : 0);
}
