import {
  Mesh,
  RawTexture,
  VertexData,
  type Scene,
} from '@babylonjs/core';
import { HEX_SIZE, hexCornerOffset, axialToWorld, AXIAL_DIRS } from './coords';
import { HexMap } from './HexMap';
import {
  bindMapData,
  createHexTerrainMaterial,
  type HexTerrainMaterial,
} from '../render/HexTerrainMaterial';
import {
  ELEV_SCALE,
  CLIFF_DROP,
  RAMP_DROP,
  edgeNeighbour,
  isWaterTerrain,
  isWaterLocal,
  cellTopY,
  cornerTopY,
  rawElev,
  rawMountainW,
  rawForestW,
  weldCornerScalar,
  avg7,
} from './terrainContinuity';

export const CHUNK_SIZE = 8;
export { ELEV_SCALE, CLIFF_DROP, RAMP_DROP };

export interface ChunkMeshes {
  meshes: Mesh[];
  material: HexTerrainMaterial;
  mapTex0: RawTexture;
  mapTex1: RawTexture;
  dispose: () => void;
}

/**
 * Build one Mesh per 8×8 chunk with top + side hex prism geometry
 * and per-vertex terrain attributes for the procedural shader.
 * Corner heights blend toward neighbors for continuous-feeling terrain
 * while preserving Humankind-style cliff drops on large elev deltas.
 */
export function meshMap(scene: Scene, map: HexMap): ChunkMeshes {
  const material = createHexTerrainMaterial(scene);
  const { tex0, tex1 } = bindMapData(material, scene, map);
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
    mapTex0: tex0,
    mapTex1: tex1,
    dispose: () => {
      for (const m of meshes) m.dispose();
      tex0.dispose();
      tex1.dispose();
      material.dispose();
    },
  };
}

/** Water depth at a hex corner: blend with the two corner-sharing neighbors
 *  so the shallow→deep ramp reads as a gradient instead of hard hex steps. */
function cornerShoreDist(
  map: HexMap,
  lq: number,
  lr: number,
  corner: number,
  selfD: number,
): number {
  const at = (q: number, r: number): number =>
    map.inBoundsLocal(q, r) ? map.getLocal(q, r).shoreDist : 1;
  const d0 = AXIAL_DIRS[corner]!;
  const d1 = AXIAL_DIRS[(corner + 1) % 6]!;
  const n0 = at(lq + d0.q, lr + d0.r);
  const n1 = at(lq + d1.q, lr + d1.r);
  return Math.min(1, selfD * 0.34 + n0 * 0.33 + n1 * 0.33);
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
  const shoreDists: number[] = [];
  const mountainWs: number[] = [];
  const forestWs: number[] = [];
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
      const isWater = isWaterTerrain(cell.terrainId);
      // Open water shares one surface level so neighbours never show a step
      const yTopFlat = isWater ? 0.02 : cell.elev * ELEV_SCALE;

      const elevC = avg7(map, lq, lr, rawElev);
      const mountainW = avg7(map, lq, lr, rawMountainW);
      const forestW = avg7(map, lq, lr, rawForestW);
      const cornerYs: number[] = [];
      const cornerElev: number[] = [];
      const cornerMW: number[] = [];
      const cornerFW: number[] = [];
      for (let i = 0; i < 6; i++) {
        cornerYs.push(cornerTopY(map, lq, lr, i, yTopFlat, isWater));
        cornerElev.push(weldCornerScalar(map, lq, lr, i, rawElev));
        cornerMW.push(weldCornerScalar(map, lq, lr, i, rawMountainW));
        cornerFW.push(weldCornerScalar(map, lq, lr, i, rawForestW));
      }

      const cellShore = isWater ? cell.shoreDist : 0;
      const cornerShore = (i: number): number =>
        isWater ? cornerShoreDist(map, lq, lr, i, cellShore) : 0;
      // Center uses the corner average so the depth field stays a smooth
      // piecewise-linear field (no per-hex center spike).
      let centerShore = 0;
      if (isWater) {
        for (let i = 0; i < 6; i++) centerShore += cornerShore(i);
        centerShore /= 6;
      }

      // --- Top face ---
      // The fan centre uses the mean of the welded corners, so a cell is not a
      // tent over its neighbours (that read as per-hex facets).
      let yCenter = yTopFlat;
      if (!isWater) {
        // No per-cell dome: the centre sits on the mean of its welded corners.
        for (let i = 0; i < 6; i++) yCenter += cornerYs[i]!;
        yCenter /= 7;
      }
      const topCenter = base;
      pushV(positions, normals, cxw, yCenter, czw, 0, 1, 0);
      pushAttr(
        terrainIds, featureIds, elevs, moistures, edgeMasks, hexCorners, shoreDists, mountainWs, forestWs, uvs,
        cell, -1, 0, 0, centerShore, elevC, mountainW, forestW,
      );
      base++;

      const topCorners: number[] = [];
      for (let i = 0; i < 6; i++) {
        const c = hexCornerOffset(i, HEX_SIZE);
        pushV(positions, normals, cxw + c.x, cornerYs[i]!, czw + c.z, 0, 1, 0);
        pushAttr(
          terrainIds, featureIds, elevs, moistures, edgeMasks, hexCorners, shoreDists, mountainWs, forestWs, uvs,
          cell, i, c.x, c.z, cornerShore(i), cornerElev[i]!, cornerMW[i]!, cornerFW[i]!,
        );
        topCorners.push(base);
        base++;
      }
      for (let i = 0; i < 6; i++) {
        indices.push(topCenter, topCorners[i]!, topCorners[(i + 1) % 6]!);
      }

      // --- Sides: skip / ramp / cliff. Only the higher cell emits. ---
      for (let i = 0; i < 6; i++) {
        const nb = edgeNeighbour(map, lq, lr, i);
        if (!nb) continue;
        const nq = nb[0];
        const nr = nb[1];
        const inB = map.inBoundsLocal(nq, nr);
        const nWater = isWaterLocal(map, nq, nr);
        if (isWater && (nWater || !inB)) continue;

        const neighborTop = cellTopY(map, nq, nr);
        const yA = cornerYs[i]!;
        const yB = cornerYs[(i + 1) % 6]!;
        const yBotA = inB ? cornerTopY(map, nq, nr, i, neighborTop, nWater) : 0.02;
        const yBotB = inB ? cornerTopY(map, nq, nr, (i + 1) % 6, neighborTop, nWater) : 0.02;
        const nEdge = Math.max(yBotA, yBotB);
        const drop = Math.min(yA, yB) - nEdge;
        // Land->water edges always get a short beach wall so the apron lip
        // meets the water surface (no gap, no floating block). Land->land
        // walls still need a real cliff drop.
        const shoreEdge = inB && !isWater && nWater;
        if (drop < CLIFF_DROP && !(shoreEdge && drop > RAMP_DROP)) continue;
        if (inB && !isWater && !nWater && Math.abs(cell.elev - map.getLocal(nq, nr).elev) < 0.07) continue;
        const selfMid = (yA + yB) * 0.5;
        if (inB && selfMid < nEdge) continue;

        const c0 = hexCornerOffset(i, HEX_SIZE);
        const c1 = hexCornerOffset((i + 1) % 6, HEX_SIZE);
        const mx = (c0.x + c1.x) * 0.5;
        const mz = (c0.z + c1.z) * 0.5;
        const len = Math.hypot(mx, mz) || 1;
        let nx = mx / len;
        let ny = 0;
        let nz = mz / len;
        const nCell = inB ? map.getLocal(nq, nr) : cell;
        const nShore = inB && nWater ? nCell.shoreDist : 0;
        const eA = cornerElev[i]!;
        const eB = cornerElev[(i + 1) % 6]!;
        const mA = cornerMW[i]!;
        const mB = cornerMW[(i + 1) % 6]!;
        const fA = cornerFW[i]!;
        const fB = cornerFW[(i + 1) % 6]!;
        const nEA = inB ? weldCornerScalar(map, nq, nr, i, rawElev) : 0;
        const nEB = inB ? weldCornerScalar(map, nq, nr, (i + 1) % 6, rawElev) : 0;
        const nMA = inB ? weldCornerScalar(map, nq, nr, i, rawMountainW) : 0;
        const nMB = inB ? weldCornerScalar(map, nq, nr, (i + 1) % 6, rawMountainW) : 0;
        const nFA = inB ? weldCornerScalar(map, nq, nr, i, rawForestW) : 0;
        const nFB = inB ? weldCornerScalar(map, nq, nr, (i + 1) % 6, rawForestW) : 0;

        const i0 = base;
        pushV(positions, normals, cxw + c0.x, yA, czw + c0.z, nx, ny, nz);
        pushAttr(
          terrainIds, featureIds, elevs, moistures, edgeMasks, hexCorners, shoreDists, mountainWs, forestWs, uvs,
          cell, i, c0.x, c0.z, cellShore, eA, mA, fA,
        );
        base++;
        const i1 = base;
        pushV(positions, normals, cxw + c1.x, yB, czw + c1.z, nx, ny, nz);
        pushAttr(
          terrainIds, featureIds, elevs, moistures, edgeMasks, hexCorners, shoreDists, mountainWs, forestWs, uvs,
          cell, i + 1, c1.x, c1.z, cellShore, eB, mB, fB,
        );
        base++;
        const i2 = base;
        pushV(positions, normals, cxw + c1.x, yBotB, czw + c1.z, nx, ny, nz);
        pushAttr(
          terrainIds, featureIds, elevs, moistures, edgeMasks, hexCorners, shoreDists, mountainWs, forestWs, uvs,
          nCell, i + 1, c1.x, c1.z, nShore, nEB, nMB, nFB,
        );
        base++;
        const i3 = base;
        pushV(positions, normals, cxw + c0.x, yBotA, czw + c0.z, nx, ny, nz);
        pushAttr(
          terrainIds, featureIds, elevs, moistures, edgeMasks, hexCorners, shoreDists, mountainWs, forestWs, uvs,
          nCell, i, c0.x, c0.z, nShore, nEA, nMA, nFA,
        );
        base++;

        indices.push(i0, i1, i2, i0, i2, i3);
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
  mesh.setVerticesData('shoreDist', shoreDists, false, 1);
  mesh.setVerticesData('mountainW', mountainWs, false, 1);
  mesh.setVerticesData('forestW', forestWs, false, 1);

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
  shoreDists: number[],
  mountainWs: number[],
  forestWs: number[],
  uvs: number[],
  cell: { terrainId: number; featureId: number; elev: number; moisture: number; edgeMask: number },
  corner: number,
  lx: number,
  lz: number,
  shoreDist: number,
  elevW: number,
  mountainW: number,
  forestW: number,
): void {
  terrainIds.push(cell.terrainId);
  featureIds.push(cell.featureId);
  elevs.push(elevW);
  moistures.push(cell.moisture);
  edgeMasks.push(cell.edgeMask);
  hexCorners.push(corner < 0 ? -1 : corner % 6);
  shoreDists.push(shoreDist);
  mountainWs.push(mountainW);
  forestWs.push(forestW);
  uvs.push(lx * 0.5 + 0.5, lz * 0.5 + 0.5);
}
