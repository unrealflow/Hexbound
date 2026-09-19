import './style.css';
import {
  Color3,
  MeshBuilder,
  PointerEventTypes,
  StandardMaterial,
} from '@babylonjs/core';
import { createScene, panCamera } from './scene/createScene';
import { axialToWorld, worldToAxial } from './hex/coords';
import { heightAt, pickTerrain } from './hex/terrainContinuity';
import { generateMap } from './hex/mapgen';
import { meshMap, type ChunkMeshes } from './hex/ChunkMesher';
import { updateTerrainMaterial } from './render/HexTerrainMaterial';
import { createDebugPanel } from './ui/debugPanel';
import { type HexMap } from './hex/HexMap';

const DEFAULT_SEED = 20260916;
const MAP_W = 40;
const MAP_H = 32;

const app = document.querySelector<HTMLDivElement>('#app')!;
const canvas = document.createElement('canvas');
canvas.id = 'renderCanvas';
app.appendChild(canvas);

const { engine, scene, camera, setOrthoSize, getOrthoSize } = createScene(canvas);
const panel = createDebugPanel(DEFAULT_SEED);

let map: HexMap = generateMap({ seed: DEFAULT_SEED, width: MAP_W, height: MAP_H });
let chunks: ChunkMeshes = meshMap(scene, map);

const highlight = MeshBuilder.CreateDisc(
  'hexHighlight',
  { radius: 0.92, tessellation: 6 },
  scene,
);
highlight.rotation.x = Math.PI / 2;
highlight.rotation.y = Math.PI / 6; // align pointy-top
highlight.position.y = 0.08;
highlight.isPickable = false;
const hlMat = new StandardMaterial('hlMat', scene);
hlMat.emissiveColor = new Color3(0.95, 0.85, 0.25);
hlMat.diffuseColor = new Color3(0, 0, 0);
hlMat.specularColor = new Color3(0, 0, 0);
hlMat.alpha = 0.55;
highlight.material = hlMat;
highlight.setEnabled(false);

function rebuild(seed: number): void {
  chunks.dispose();
  map = generateMap({ seed, width: MAP_W, height: MAP_H });
  chunks = meshMap(scene, map);
  highlight.setEnabled(false);
  panel.setSelected(null);
}

panel.onReseed((seed) => rebuild(seed));
panel.onToggle(() => {
  /* uniforms refreshed each frame */
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    setOrthoSize(getOrthoSize() * (e.deltaY > 0 ? 1.08 : 0.92));
  },
  { passive: false },
);

let dragging = false;
let lastX = 0;
let lastY = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 1 || e.button === 2) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  const scale = (getOrthoSize() * 2) / Math.max(1, canvas.clientHeight);
  panCamera(camera, -dx * scale, dy * scale);
});
canvas.addEventListener('pointerup', (e) => {
  if (e.button === 1 || e.button === 2) dragging = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

scene.onPointerObservable.add((pi) => {
  if (pi.type !== PointerEventTypes.POINTERPICK) return;
  if (pi.event.button !== 0) return;

  const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, null, camera);
  // Picking follows the CPU height field, not the render mesh: the mesh is the
  // displaced approximation of that field, so picking it (or the y = 0 plane)
  // selected a hex offset from the one under the cursor on any slope.
  const hit = pickTerrain(map, ray.origin, ray.direction);
  if (!hit) {
    highlight.setEnabled(false);
    panel.setSelected(null);
    return;
  }
  const axial = worldToAxial(hit.x, hit.z);
  const cell = map.get(axial.q, axial.r);
  if (!cell) {
    highlight.setEnabled(false);
    panel.setSelected(null);
    return;
  }

  panel.setSelected(cell);
  const w = axialToWorld(cell.q, cell.r);
  highlight.position.x = w.x;
  highlight.position.z = w.z;
  highlight.position.y = heightAt(map, w.x, w.z) + 0.10;
  highlight.setEnabled(true);
});

engine.runRenderLoop(() => {
  const time = performance.now() * 0.001;
  const st = panel.getState();
  updateTerrainMaterial(chunks.material, time, camera.position, {
    enableDisplace: st.enableDisplace,
    enableFog: st.enableFog,
    showWireHint: st.showWireHint,
    useDetailTex: st.useDetailTex,
  });
  scene.render();
});

window.addEventListener('resize', () => engine.resize());

console.info(
  `[Hexbound] map ${MAP_W}×${MAP_H}, chunks=${chunks.meshes.length}, seed=${DEFAULT_SEED}, no runtime textures`,
);

// Debug hook for headless capture diagnostics
(window as unknown as { __hexbound?: unknown }).__hexbound = {
  scene,
  camera,
  chunks,
  map,
  engine,
  // The two calls the pointer handler makes, so headless checks exercise the
  // same picking path the app uses.
  terrainHeight: (x: number, z: number, mode?: 'shader' | 'preview' | 'none') =>
    heightAt(map, x, z, mode),
  pickTerrain: (
    o: { x: number; y: number; z: number },
    d: { x: number; y: number; z: number },
    mode?: 'shader' | 'preview' | 'none',
  ) => pickTerrain(map, o, d, 120, mode),
};
