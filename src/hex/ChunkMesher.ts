import {
  Mesh,
  VertexData,
  type Scene,
} from '@babylonjs/core';
import { HEX_SIZE, hexCornerOffset, axialToWorld, AXIAL_DIRS } from './coords';
import { HexMap, Terrain } from './HexMap';
import { createHexTerrainMaterial, type HexTerrainMaterial } from '../render/HexTerrainMaterial';

export const CHUNK_SIZE = 8;
export const ELEV_SCALE = 1.55;

export interface ChunkMeshes {
  meshes: Mesh[];
  material: HexTerrainMaterial;
  dispose: () => void;
}

/**
 * Build one Mesh per 8×8 chunk with top + side hex prism geometry
 * and per-vertex terrain attributes for the procedural shader.
 * Side faces drop to neighbor tops for Humankind-style cliff terraces.
 */
export function meshMap(scene: Scene, map: HexMap): ChunkMeshes {
  const material = createHexTerrainMaterial(scene);
  const meshes: Mesh[] = [];

  const chunksX = Math.ceil(map.width / CHUNK_SIZE);
  const chunksZ = Math.ceil(map.height / CHUNK_SIZE);

  for (let cz = 0; cz < chunksZ; cz++) {
    for (let cx = 0; cx < chunksX; cx++) {
      const mesh = buildChunkMesh(scene, map, cx, cz, material);
      if (mesh) meshes.push(mesh);
    }
  }

  return {
    meshes,
    material,
    dispose: () => {
      for (const m of meshes) m.dispose();
      material.dispose();
    },
  };
}

function cellTopY(map: HexMap, localQ: number, localR: number): number {
  if (!map.inBoundsLocal(localQ, localR)) return 0;
  const cell = map.getLocal(localQ, localR);
  const isWater =
    cell.terrainId === Terrain.ShallowWater || cell.terrainId === Terrain.DeepWater;
  return isWater ? 0.02 : cell.elev * ELEV_SCALE;
}

function buildChunkMesh(
  scene: Scene,
  map: HexMap,
  cx: number,
  cz: number,
  material: HexTerrainMaterial,
): Mesh | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const terrainIds: number[] = [];
  const featureIds: number[] = [];
  const elevs: number[] = [];
  const moistures: number[] = [];
  const edgeMasks: number[] = [];
  const hexCorners: number[] = [];
  const uvs: number[] = [];

  let base = 0;
  let cellCount = 0;

  const q0 = cx * CHUNK_SIZE;
  const r0 = cz * CHUNK_SIZE;
  const q1 = Math.min(q0 + CHUNK_SIZE, map.width);
  const r1 = Math.min(r0 + CHUNK_SIZE, map.height);

  for (let lr = r0; lr < r1; lr++) {
    for (let lq = q0; lq < q1; lq++) {
      const cell = map.getLocal(lq, lr);
      const { x: cxw, z: czw } = axialToWorld(cell.q, cell.r, HEX_SIZE);
      const isWater =
        cell.terrainId === Terrain.ShallowWater || cell.terrainId === Terrain.DeepWater;
      const isDeep = cell.terrainId === Terrain.DeepWater;
      const yTop = isWater ? (isDeep ? -0.02 : 0.04) : cell.elev * ELEV_SCALE;

      // Base of prism: at least a skirt, or down to lowest neighbor for cliffs
      let minNeighborY = yTop;
      for (let d = 0; d < 6; d++) {
        const dir = AXIAL_DIRS[d]!;
        const nq = lq + dir.q;
        const nr = lr + dir.r;
        const ny = cellTopY(map, nq, nr);
        minNeighborY = Math.min(minNeighborY, ny);
      }
      const skirt = isWater ? 0.2 : 0.28 + cell.elev * 0.55;
      const yBot = isWater
        ? -0.18
        : Math.min(yTop - skirt, minNeighborY - 0.02);

      // --- Top face: center + 6 corners ---
      const topCenter = base;
      pushV(positions, normals, cxw, yTop, czw, 0, 1, 0);
      pushAttr(terrainIds, featureIds, elevs, moistures, edgeMasks, hexCorners, uvs, cell, -1, 0, 0);
      base++;

      const topCorners: number[] = [];
      for (let i = 0; i < 6; i++) {
        const c = hexCornerOffset(i, HEX_SIZE * 0.98);
        pushV(positions, normals, cxw + c.x, yTop, czw + c.z, 0, 1, 0);
        pushAttr(terrainIds, featureIds, elevs, moistures, edgeMasks, hexCorners, uvs, cell, i, c.x, c.z);
        topCorners.push(base);
        base++;
      }
      for (let i = 0; i < 6; i++) {
        indices.push(topCenter, topCorners[i]!, topCorners[(i + 1) % 6]!);
      }

      // --- Sides: always for land; shallow banks for water; skip deep clutter ---
      if (!isDeep) {
        for (let i = 0; i < 6; i++) {
          const dir = AXIAL_DIRS[i]!;
          const nq = lq + dir.q;
          const nr = lr + dir.r;
          const neighborTop = cellTopY(map, nq, nr);
          // Drop this edge face to neighbor top (cliff wall) or full skirt
          const edgeBot = isWater
            ? yBot
            : Math.min(yTop - 0.12, Math.min(neighborTop, yBot));

          // Skip nearly flat coplanar sides between equal land tiles (reduces z-fight)
          const drop = yTop - edgeBot;
          if (!isWater && drop < 0.08 && map.inBoundsLocal(nq, nr)) {
            const nCell = map.getLocal(nq, nr);
            const nWater =
              nCell.terrainId === Terrain.ShallowWater ||
              nCell.terrainId === Terrain.DeepWater;
            if (!nWater && Math.abs(nCell.elev - cell.elev) < 0.04) continue;
          }

          const c0 = hexCornerOffset(i, HEX_SIZE * 0.98);
          const c1 = hexCornerOffset((i + 1) % 6, HEX_SIZE * 0.98);
          const mx = (c0.x + c1.x) * 0.5;
          const mz = (c0.z + c1.z) * 0.5;
          const len = Math.hypot(mx, mz) || 1;
          const nx = mx / len;
          const nz = mz / len;

          const i0 = base;
          pushV(positions, normals, cxw + c0.x, yTop, czw + c0.z, nx, 0, nz);
          pushAttr(terrainIds, featureIds, elevs, moistures, edgeMasks, hexCorners, uvs, cell, i, c0.x, c0.z);
          base++;
          const i1 = base;
          pushV(positions, normals, cxw + c1.x, yTop, czw + c1.z, nx, 0, nz);
          pushAttr(terrainIds, featureIds, elevs, moistures, edgeMasks, hexCorners, uvs, cell, i + 1, c1.x, c1.z);
          base++;
          const i2 = base;
          pushV(positions, normals, cxw + c1.x, edgeBot, czw + c1.z, nx, 0, nz);
          pushAttr(terrainIds, featureIds, elevs, moistures, edgeMasks, hexCorners, uvs, cell, i + 1, c1.x, c1.z);
          base++;
          const i3 = base;
          pushV(positions, normals, cxw + c0.x, edgeBot, czw + c0.z, nx, 0, nz);
          pushAttr(terrainIds, featureIds, elevs, moistures, edgeMasks, hexCorners, uvs, cell, i, c0.x, c0.z);
          base++;

          indices.push(i0, i1, i2, i0, i2, i3);
        }
      }

      cellCount++;
    }
  }

  if (cellCount === 0) return null;

  const mesh = new Mesh(`chunk_${cx}_${cz}`, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.indices = indices;
  vd.uvs = uvs;
  vd.applyToMesh(mesh, true);

  mesh.setVerticesData('terrainId', terrainIds, false, 1);
  mesh.setVerticesData('featureId', featureIds, false, 1);
  mesh.setVerticesData('elev', elevs, false, 1);
  mesh.setVerticesData('moisture', moistures, false, 1);
  mesh.setVerticesData('edgeMask', edgeMasks, false, 1);
  mesh.setVerticesData('hexCorner', hexCorners, false, 1);

  mesh.isPickable = true;
  mesh.material = material;
  mesh.metadata = { cx, cz };

  return mesh;
}

function pushV(
  positions: number[],
  normals: number[],
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
): void {
  positions.push(x, y, z);
  normals.push(nx, ny, nz);
}

function pushAttr(
  terrainIds: number[],
  featureIds: number[],
  elevs: number[],
  moistures: number[],
  edgeMasks: number[],
  hexCorners: number[],
  uvs: number[],
  cell: { terrainId: number; featureId: number; elev: number; moisture: number; edgeMask: number },
  corner: number,
  lx: number,
  lz: number,
): void {
  terrainIds.push(cell.terrainId);
  featureIds.push(cell.featureId);
  elevs.push(cell.elev);
  moistures.push(cell.moisture);
  edgeMasks.push(cell.edgeMask);
  hexCorners.push(corner < 0 ? -1 : corner % 6);
  uvs.push(lx * 0.5 + 0.5, lz * 0.5 + 0.5);
}
