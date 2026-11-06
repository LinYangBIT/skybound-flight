import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './dist/vendor/three.module.js';
import { createEnvironment } from './dist/environment.js';
import { createTerrainSurface, sampleTerrainSurface, sampleTerrainHeight } from './dist/terrain-sampling.js';

function grid(heights, { minX = 0, minZ = 0, width = 10, depth = 10, nx = 1, nz = 1 } = {}) {
  const positions = new Float32Array((nx + 1) * (nz + 1) * 3);
  for (let z = 0; z <= nz; z++) for (let x = 0; x <= nx; x++) {
    const index = z * (nx + 1) + x;
    positions.set([minX + x / nx * width, heights[index], minZ + z / nz * depth], index * 3);
  }
  return createTerrainSurface(positions, nx, nz);
}

test('ridge queries follow both rendered triangles instead of an invented bilinear slope', () => {
  const surface = grid([0, 100, 100, 0]);
  assert.equal(sampleTerrainSurface(surface, 5, 5), 100);
  assert.equal(sampleTerrainSurface(surface, 2, 3), 50);
  assert.equal(sampleTerrainSurface(surface, 8, 7), 50);
});

test('grid edges and distant Float32 cell boundaries remain continuous and finite', () => {
  const surface = grid([1, 3, 5, 11, 13, 15, 21, 23, 25], { minX: -6237.53, minZ: -7053.41, width: 33.33, depth: 41.41, nx: 2, nz: 2 });
  const { positions: p } = surface;
  for (let index = 0; index < 9; index++) assert.equal(sampleTerrainSurface(surface, p[index * 3], p[index * 3 + 2]), p[index * 3 + 1]);
  assert.ok(Math.abs(sampleTerrainSurface(surface, p[12] - 1e-7, p[14]) - sampleTerrainSurface(surface, p[12] + 1e-7, p[14])) < 1e-6);
  assert.equal(sampleTerrainSurface(surface, surface.maxX + 1, surface.maxZ), -Infinity);
  assert.equal(sampleTerrainSurface(surface, NaN, 0), -Infinity);
});

test('overlapping islands use the upper visible face and ocean remains at sea level', () => {
  const low = grid([9, 9, 9, 9]);
  const high = grid([30, 30, 30, 30], { minX: 5, minZ: 5 });
  const submerged = grid([-2, -2, -2, -2], { minX: -20 });
  assert.equal(sampleTerrainHeight([high, low], 7, 7), 30);
  assert.equal(sampleTerrainHeight([low, high], 7, 7), 30);
  assert.equal(sampleTerrainHeight([low, high], 2, 2), 9);
  assert.equal(sampleTerrainHeight([submerged], -15, 5), 0);
  assert.equal(sampleTerrainHeight([low, high], 100, 100), 0);
});

// Create the real terrain geometry with inert texture drawing calls. These
// tests check collision/mesh agreement; they do not claim browser rendering QA.
function environmentGeometry() {
  const previousDocument = globalThis.document;
  const context = {
    fillRect() {}, fillText() {}, save() {}, translate() {}, rotate() {}, restore() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  try {
    const scene = new THREE.Scene();
    const environment = createEnvironment(scene);
    scene.updateMatrixWorld(true);
    const meshes = scene.children.filter(mesh => mesh.isMesh && mesh.material.customProgramCacheKey() === 'skybound-real-terrain-v2');
    return { environment, meshes };
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}
const { environment, meshes } = environmentGeometry();
const raycaster = new THREE.Raycaster();
function visibleHeight(x, z) {
  raycaster.set(new THREE.Vector3(x, 20000, z), new THREE.Vector3(0, -1, 0));
  const hits = raycaster.intersectObjects(meshes, false);
  return Math.max(0, hits[0]?.point.y ?? 0);
}

test('real island queries match raycast mesh faces, including the former 310 metre phantom ridge', () => {
  assert.equal(meshes.length, 12);
  const points = [[-6237.5, -7053.409090909091]];
  for (const island of environment.islands) for (const offset of [[0, 0], [.23, .17], [-.42, .31], [.74, -.12]]) {
    points.push([island.x + island.rx * offset[0], island.z + island.rz * offset[1]]);
  }
  for (const [x, z] of points) {
    const sampled = environment.heightAt(x, z), rendered = visibleHeight(x, z);
    assert.ok(Math.abs(sampled - rendered) < 1e-6, `height mismatch at ${x}, ${z}: ${sampled} versus ${rendered}`);
  }
  assert.ok(environment.heightAt(...points[0]) < 715, 'collision must use the visible ridge, not the old 1022 metre noise peak');
});

test('runway ground stays level through both approaches and the full landing strip', () => {
  for (const x of [-45, 0, 45]) for (const z of [-1000, -900, -500, 0, 500, 900, 1000]) {
    assert.equal(environment.heightAt(x, z), 9);
    assert.ok(Math.abs(visibleHeight(x, z) - 9) < 1e-6);
  }
});
