import {
  Mesh,
  RawTexture,
  VertexData,
  type Scene,
} from '@babylonjs/core';
import { HEX_SIZE, hexCornerOffset, axialToWorld } from './coords';
import { HexMap } from './HexMap';
import {
  bindMapData,
  createHexTerrainMaterial,
  type HexTerrainMaterial,
} from '../render/HexTerrainMaterial';
import {
  ELEV_SCALE,
  isWaterTerrain,
  cornerTopY,
  rawElev,
  rawMountainW,
  rawForestW,
  weldCornerScalar,
  avg7,
  dispWeight,
} from './terrainContinuity';

export const CHUNK_SIZE = 8;
export { ELEV_SCALE };

export interface ChunkMeshes {
  meshes: Mesh[];
  material: HexTerrainMaterial;
  mapTex0: RawTexture;
  mapTex1: RawTexture;
  dispose: () => void;
}

/**
 * Build one Mesh per 8×8 chunk with top hex geometry and per-vertex terrain
 * attributes for the procedural shader.
 *
 * There are no side walls: every world corner is welded to a single height (see
 * terrainContinuity.cornerTopY), so the fans of adjacent cells share their rim
 * vertices exactly and the surface is watertight and continuous by
 * construction. The terrain spec requires any planar cross-section to be a
 * continuous smooth curve — no vertical walls, no terrace steps — so steep
 * ground is expressed purely as a steep slope of the welded field plus the
 * continuous vertex displacement.
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
  const mountainWs: number[] = [];
  const forestWs: number[] = [];
  const dispWs: number[] = [];
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
      const cornerDisp: number[] = [];
      for (let i = 0; i < 6; i++) {
        const c = hexCornerOffset(i, HEX_SIZE);
        cornerYs.push(cornerTopY(map, lq, lr, i, yTopFlat, isWater));
        cornerElev.push(weldCornerScalar(map, lq, lr, i, rawElev));
        cornerMW.push(weldCornerScalar(map, lq, lr, i, rawMountainW));
        cornerFW.push(weldCornerScalar(map, lq, lr, i, rawForestW));
        // World-position only, so the two copies of a shared corner agree.
        cornerDisp.push(dispWeight(map, cxw + c.x, czw + c.z));
      }
      // The fan centre takes its corners' mean gate, so it never sits proud of
      // or below the rim it is welded to.
      let centerDisp = 0;
      for (let i = 0; i < 6; i++) centerDisp += cornerDisp[i]!;
      centerDisp /= 6;

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
        terrainIds, featureIds, elevs, moistures, edgeMasks, hexCorners, mountainWs, forestWs, dispWs, uvs,
        cell, -1, 0, 0, elevC, mountainW, forestW, centerDisp,
      );
      base++;

      const topCorners: number[] = [];
      for (let i = 0; i < 6; i++) {
        const c = hexCornerOffset(i, HEX_SIZE);
        pushV(positions, normals, cxw + c.x, cornerYs[i]!, czw + c.z, 0, 1, 0);
        pushAttr(
          terrainIds, featureIds, elevs, moistures, edgeMasks, hexCorners, mountainWs, forestWs, dispWs, uvs,
          cell, i, c.x, c.z, cornerElev[i]!, cornerMW[i]!, cornerFW[i]!, cornerDisp[i]!,
        );
        topCorners.push(base);
        base++;
      }
      for (let i = 0; i < 6; i++) {
        indices.push(topCenter, topCorners[i]!, topCorners[(i + 1) % 6]!);
      }

      // No side walls: adjacent fans share their welded rim vertices exactly, so
      // the surface is continuous and watertight by construction.

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
  mesh.setVerticesData('mountainW', mountainWs, false, 1);
  mesh.setVerticesData('forestW', forestWs, false, 1);
  mesh.setVerticesData('dispW', dispWs, false, 1);

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
  mountainWs: number[],
  forestWs: number[],
  dispWs: number[],
  uvs: number[],
  cell: { terrainId: number; featureId: number; elev: number; moisture: number; edgeMask: number },
  corner: number,
  lx: number,
  lz: number,
  elevW: number,
  mountainW: number,
  forestW: number,
  dispW: number,
): void {
  terrainIds.push(cell.terrainId);
  featureIds.push(cell.featureId);
  elevs.push(elevW);
  moistures.push(cell.moisture);
  edgeMasks.push(cell.edgeMask);
  hexCorners.push(corner < 0 ? -1 : corner % 6);
  mountainWs.push(mountainW);
  forestWs.push(forestW);
  dispWs.push(dispW);
  uvs.push(lx * 0.5 + 0.5, lz * 0.5 + 0.5);
}
