import {
  Camera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  FreeCamera,
  HemisphericLight,
  Scene,
  Vector3,
} from '@babylonjs/core';

export interface SceneBundle {
  engine: Engine;
  scene: Scene;
  camera: FreeCamera;
  setOrthoSize: (size: number) => void;
  getOrthoSize: () => number;
}

/**
 * Slightly oblique orthographic camera (Civ / Humankind feel) so cliffs and
 * water depth read clearly while staying mostly top-down.
 */
export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    adaptToDeviceRatio: true,
  });

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.10, 0.14, 0.20, 1);
  scene.fogMode = Scene.FOGMODE_NONE;

  let orthoSize = 20;
  // More oblique: lower Y, farther Z → ~50° pitch from horizontal, cliffs readable
  const camera = new FreeCamera('orthoCam', new Vector3(0, 26, 34), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.setTarget(new Vector3(0, 0.5, 0));
  camera.minZ = 0.5;
  camera.maxZ = 250;

  const applyOrtho = () => {
    const aspect = engine.getAspectRatio(camera);
    camera.orthoLeft = -orthoSize * aspect;
    camera.orthoRight = orthoSize * aspect;
    camera.orthoTop = orthoSize;
    camera.orthoBottom = -orthoSize;
  };
  applyOrtho();

  const sun = new DirectionalLight('sun', new Vector3(-0.55, -0.75, -0.4), scene);
  sun.intensity = 1.15;
  sun.diffuse = new Color3(1.0, 0.95, 0.86);

  const hemi = new HemisphericLight('hemi', new Vector3(0.15, 1, 0.1), scene);
  hemi.intensity = 0.58;
  hemi.groundColor = new Color3(0.22, 0.18, 0.12);
  hemi.diffuse = new Color3(0.55, 0.65, 0.8);

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
