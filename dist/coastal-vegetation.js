import * as THREE from './vendor/three.module.js';

// Original opaque coastal vegetation. Broad, wind-shaped crowns sit in small
// sheltered patches; no alpha cards, cone trees or per-frame procedural work.
export function createCoastalVegetation(scene, heightAt) {
  const root = new THREE.Group(); root.name = 'Coastal scrub and wind-shaped trees';
  let seed = 842103;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const merge = parts => {
    const result = new THREE.BufferGeometry(), attributes = {};
    for (const name of ['position', 'normal', 'color']) {
      const arrays = parts.map(part => part.attributes[name].array);
      const data = new Float32Array(arrays.reduce((sum, array) => sum + array.length, 0));
      let offset = 0; for (const array of arrays) { data.set(array, offset); offset += array.length; }
      attributes[name] = new THREE.BufferAttribute(data, 3); result.setAttribute(name, attributes[name]);
    }
    for (const part of parts) part.dispose();
    result.computeBoundingBox(); result.computeBoundingSphere(); return result;
  };
  function leafLobe(x, y, z, sx, sy, sz, variant, detailed = false) {
    const shape = detailed ? new THREE.SphereGeometry(1, 8, 4) : new THREE.IcosahedronGeometry(1, 0);
    const positions = shape.attributes.position, normals = shape.attributes.normal;
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      const px = positions.getX(i), py = positions.getY(i), pz = positions.getZ(i);
      // Stable coordinate hash: shared vertices stay joined. Distorted lobes
      // form different crown edges without a uniformly spherical outline.
      const h = Math.sin(px * 17.1 + py * 31.7 + pz * 47.9 + variant * 3.8);
      const radial = 1 + h * .17 + Math.sin(px * 5.1 + pz * 3.8 + variant) * .09;
      positions.setXYZ(i, x + px * sx * radial + py * .12, y + py * sy * radial, z + pz * sz * radial);
      const n = new THREE.Vector3(px / sx, py / sy, pz / sz).normalize(); normals.setXYZ(i, n.x, n.y, n.z);
      // Leaf undersides remain darker even with low quality shadow maps off.
      const brightness = .62 + (py + 1) * .16 + h * .055;
      colors.set([brightness * .96, brightness, brightness * .92], i * 3);
    }
    shape.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const output = shape.index ? shape.toNonIndexed() : shape.clone(); shape.dispose(); return output;
  }
  const broadCrown = merge([
    leafLobe(.1, .78, 0, .69, .24, .52, 1, true),
    leafLobe(-.39, .69, .26, .38, .21, .36, 2),
    leafLobe(.53, .67, -.18, .4, .22, .37, 3),
  ]);
  const scrubCrown = merge([
    leafLobe(-.17, .47, 0, .52, .29, .49, 4),
    leafLobe(.38, .58, -.04, .46, .27, .40, 5),
    leafLobe(-.3, .35, .36, .38, .22, .32, 6),
  ]);
  const woodParts = [];
  function branch(from, to, base, tip, sides) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(tip, base, direction.length(), sides, 1, true);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    geometry.translate(...a.add(b).multiplyScalar(.5).toArray());
    const output = geometry.toNonIndexed(); geometry.dispose();
    const colors = new Float32Array(output.attributes.position.count * 3); colors.fill(1);
    output.setAttribute('color', new THREE.BufferAttribute(colors, 3)); woodParts.push(output);
  }
  branch([0, -.025, 0], [.07, .65, 0], .032, .018, 6);
  branch([.03, .34, 0], [-.33, .69, .18], .019, .008, 5);
  branch([.04, .43, 0], [.43, .68, -.15], .017, .007, 5);
  const wood = merge(woodParts);

  const clusters = [
    [-400, -1330, 85, 70], [-510, -950, 125, 120], [-285, -610, 75, 120],
    [-480, -270, 110, 100], [-340, 170, 90, 100], [-410, 640, 110, 130],
    [-340, 1050, 90, 130], [-300, 1410, 100, 100], [380, -1330, 90, 90],
    [500, -1000, 120, 120], [350, -510, 85, 100], [610, -180, 70, 90],
    [650, 550, 65, 90], [400, 1360, 100, 100],
  ];
  const placements = [], bins = new Map();
  for (let attempt = 0; attempt < 10000 && placements.length < 500; attempt++) {
    const cluster = clusters[Math.floor(random() * clusters.length)];
    const angle = random() * Math.PI * 2, radius = Math.pow(random(), .72);
    const x = cluster[0] + Math.cos(angle) * radius * cluster[2], z = cluster[1] + Math.sin(angle) * radius * cluster[3];
    if (Math.abs(x) < 155 || Math.abs(x) > 880 || Math.abs(z) > 1770 || (x > 50 && x < 550 && z > 0 && z < 1100)) continue;
    const y = heightAt(x, z);
    if (y < 15 || y > 140) continue;
    if ([heightAt(x - 6, z), heightAt(x + 6, z), heightAt(x, z - 6), heightAt(x, z + 6)].some(h => Math.abs(h - y) > 3.5)) continue;
    // Sparse edge growth and a modest minimum separation prevent both a
    // regular plantation grid and coincident trunks inside dense patches.
    const cellX = Math.floor(x / 6), cellZ = Math.floor(z / 6);
    let overlap = false;
    for (let dx = -1; dx <= 1 && !overlap; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const p of bins.get(`${cellX + dx}/${cellZ + dz}`) || []) if ((p.x - x) ** 2 + (p.z - z) ** 2 < 30) { overlap = true; break; }
    }
    if (overlap) continue;
    const shrub = random() < .37, scale = shrub ? 2.4 + random() * 2.6 : 5.7 + random() * 5;
    const plant = { x, y, z, shrub, scale, angle: random() * Math.PI * 2, stretch: .84 + random() * .35, shade: random() };
    placements.push(plant);
    const key = `${cellX}/${cellZ}`; if (!bins.has(key)) bins.set(key, []); bins.get(key).push(plant);
  }

  const foliage = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .97, metalness: 0, vertexColors: true, envMapIntensity: .35 });
  const bark = new THREE.MeshStandardMaterial({ color: 0x69665c, roughness: 1, metalness: 0, vertexColors: true, envMapIntensity: .2 });
  const trees = placements.filter(plant => !plant.shrub), shrubs = placements.filter(plant => plant.shrub);
  const treeMesh = new THREE.InstancedMesh(broadCrown, foliage, trees.length);
  const shrubMesh = new THREE.InstancedMesh(scrubCrown, foliage, shrubs.length);
  const trunkMesh = new THREE.InstancedMesh(wood, bark, placements.length);
  treeMesh.name = 'Wind-shaped coastal crowns'; shrubMesh.name = 'Sheltered scrub patches'; trunkMesh.name = 'Grey coastal trunks and forked branches';
  const dummy = new THREE.Object3D(), tint = new THREE.Color(), dark = new THREE.Color(0x65705c), light = new THREE.Color(0x87917d);
  function place(mesh, plant, index, color) {
    dummy.position.set(plant.x, plant.y - .10, plant.z); dummy.rotation.set(0, plant.angle, 0);
    dummy.scale.set(plant.scale * plant.stretch, plant.scale, plant.scale * (1.08 - (plant.stretch - .84) * .35));
    dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
    if (color) mesh.setColorAt(index, tint.copy(dark).lerp(light, plant.shade));
  }
  trees.forEach((plant, index) => place(treeMesh, plant, index, true));
  shrubs.forEach((plant, index) => place(shrubMesh, plant, index, true));
  placements.forEach((plant, index) => place(trunkMesh, plant, index, false));
  for (const mesh of [treeMesh, shrubMesh, trunkMesh]) {
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere(); root.add(mesh);
  }
  root.userData.geometryBudget = {
    plants: placements.length, trees: trees.length, shrubs: shrubs.length, drawCalls: 3,
    triangles: (broadCrown.attributes.position.count * trees.length + scrubCrown.attributes.position.count * shrubs.length + wood.attributes.position.count * placements.length) / 3,
  };
  scene.add(root); return root;
}
