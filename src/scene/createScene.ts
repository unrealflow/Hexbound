import {
  Camera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  FreeCamera,
  HemisphericLight,
  MeshBuilder,
  Scene,
  ShaderMaterial,
  Effect,
  Vector3,
} from '@babylonjs/core';

export interface SceneBundle {
  engine: Engine;
  scene: Scene;
  camera: FreeCamera;
  setOrthoSize: (size: number) => void;
  getOrthoSize: () => number;
}

const SKY_VERT = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const SKY_FRAG = `
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  // Atmospheric gradient — deeper zenith, warm horizon (Atmospheric Landscape)
  vec3 col = mix(uSkyHorizon, uSkyZenith, pow(h, 1.25));
  // Horizon band warm-up
  col = mix(col, vec3(0.88, 0.82, 0.72), smoothstep(0.45, 0.52, h) * (1.0 - smoothstep(0.55, 0.72, h)) * 0.35);
  float sunAmt = max(dot(d, normalize(uSunDir)), 0.0);
  float sun = pow(sunAmt, 512.0);
  float glare = pow(sunAmt, 16.0);
  float haze = pow(sunAmt, 4.0);
  col += vec3(1.0, 0.96, 0.88) * sun * 2.2;
  col += vec3(1.0, 0.9, 0.7) * glare * 0.45;
  col += vec3(1.0, 0.85, 0.6) * haze * 0.12;
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Mildly oblique orthographic camera (Civ / Humankind) so cliffs and
 * canopy read clearly while staying mostly top-down / readable.
 */
export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    adaptToDeviceRatio: true,
  });

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.42, 0.58, 0.78, 1);
  scene.fogMode = Scene.FOGMODE_NONE;

  let orthoSize = 18;
  // Slightly more pitch so terraces / cliffs read like Humankind shots
  const camera = new FreeCamera('orthoCam', new Vector3(0, 26, 34), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.setTarget(new Vector3(0, 0.5, 0));
  camera.minZ = 0.5;
  camera.maxZ = 280;

  const applyOrtho = () => {
    const aspect = engine.getAspectRatio(camera);
    camera.orthoLeft = -orthoSize * aspect;
    camera.orthoRight = orthoSize * aspect;
    camera.orthoTop = orthoSize;
    camera.orthoBottom = -orthoSize;
  };
  applyOrtho();

  // Side-lit sun for form definition (Rainforest kSunDir spirit)
  const sunDir = new Vector3(-0.62, -0.72, -0.3);
  const sun = new DirectionalLight('sun', sunDir, scene);
  sun.intensity = 1.55;
  sun.diffuse = new Color3(1.0, 0.92, 0.78);

  const hemi = new HemisphericLight('hemi', new Vector3(0.1, 1, 0.15), scene);
  hemi.intensity = 0.42;
  hemi.groundColor = new Color3(0.22, 0.18, 0.12);
  hemi.diffuse = new Color3(0.48, 0.62, 0.85);

  // Procedural sky dome (gradient + sun disk)
  Effect.ShadersStore['hexSkyVertexShader'] = SKY_VERT;
  Effect.ShadersStore['hexSkyFragmentShader'] = SKY_FRAG;
  const sky = MeshBuilder.CreateSphere('skyDome', { diameter: 200, segments: 16 }, scene);
  sky.infiniteDistance = true;
  sky.isPickable = false;
  const skyMat = new ShaderMaterial(
    'hexSkyMat',
    scene,
    { vertex: 'hexSky', fragment: 'hexSky' },
    {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'uSunDir', 'uSkyZenith', 'uSkyHorizon'],
    },
  );
  skyMat.backFaceCulling = false;
  skyMat.setVector3('uSunDir', new Vector3(0.62, 0.72, 0.3).normalize());
  skyMat.setVector3('uSkyZenith', new Vector3(0.18, 0.38, 0.72));
  skyMat.setVector3('uSkyHorizon', new Vector3(0.72, 0.78, 0.86));
  sky.material = skyMat;
  sky.renderingGroupId = 0;
  scene.onBeforeRenderObservable.add(() => {
    sky.position.copyFrom(camera.position);
  });

  engine.onResizeObservable.add(() => applyOrtho());

  return {
    engine,
    scene,
    camera,
    setOrthoSize: (size: number) => {
      orthoSize = Math.min(60, Math.max(6, size));
      applyOrtho();
    },
    getOrthoSize: () => orthoSize,
  };
}

/** Pan by moving camera XZ. */
export function panCamera(camera: FreeCamera, dx: number, dz: number): void {
  camera.position.x += dx;
  camera.position.z += dz;
}
