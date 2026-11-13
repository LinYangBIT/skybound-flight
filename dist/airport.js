import * as THREE from './vendor/three.module.js';

// Original, metre-scale airport kit. Static parts are merged by material and
// shadow behaviour: roof ribs and window mullions do not each cost a draw call.
export function createAirport(scene, heightAt) {
  const root = new THREE.Group(); root.name = 'Qingyu air station'; scene.add(root);
  const batches = new Map(), matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  const unitScale = new THREE.Vector3(1, 1, 1);
  const material = (color, roughness = .8, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const m = {
    wall: material(0xa5aaa5, .87), base: material(0x727a76, .96),
    roof: material(0x6c7a80, .48, .52), rib: material(0x849198, .44, .65),
    frame: material(0x425158, .55, .48), steel: material(0x909d9e, .34, .83),
    interior: material(0x323b3c, .94), rubber: material(0x202729, .94),
    glass: material(0x30474e, .11, .28, { envMapIntensity: 1.2 }),
    white: material(0xcecec0, .76), yellow: material(0xafa04a, .82),
    red: material(0x934d35, .72), vehicle: material(0xb6b4a4, .47, .12),
    light: material(0xf4deaa, .4, .1, { emissive: 0xf1c478, emissiveIntensity: .28 }),
  };
  const add = (geometry, mat, x = 0, y = 0, z = 0, euler = null, cast = true) => {
    rotation.identity(); if (euler) rotation.setFromEuler(new THREE.Euler(...euler));
    matrix.compose(new THREE.Vector3(x, y, z), rotation, unitScale);
    const meshGeometry = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    meshGeometry.applyMatrix4(matrix); geometry.dispose();
    const key = `${mat.uuid}/${cast}`;
    if (!batches.has(key)) batches.set(key, { material: mat, cast, parts: [] });
    batches.get(key).parts.push(meshGeometry);
  };
  const box = (w, h, d, x, y, z, mat, euler = null, cast = true) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, euler, cast);
  const cylinder = (r1, r2, h, x, y, z, mat, euler = null, segments = 12) => add(new THREE.CylinderGeometry(r1, r2, h, segments), mat, x, y, z, euler);
  const beam = (a, b, width, depth, mat) => {
    const direction = new THREE.Vector3().subVectors(b, a), geometry = new THREE.BoxGeometry(width, direction.length(), depth);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    const p = new THREE.Vector3().addVectors(a, b).multiplyScalar(.5); add(geometry, mat, p.x, p.y, p.z);
  };
  const v = (x, y, z) => new THREE.Vector3(x, y, z);

  // One apron-wide texture keeps the weathering tied to slab joints and tyre
  // tracks. The colour map is sRGB; no colour image is reused as a bump map.
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 2048;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#8b908d'; ctx.fillRect(0, 0, 1024, 2048);
  let seed = 7310;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let row = 0; row < 40; row++) for (let col = 0; col < 14; col++) {
    const grey = 135 + Math.floor(random() * 5), x = col * 1024 / 14, y = row * 2048 / 40;
    ctx.fillStyle = `rgb(${grey},${grey + 5},${grey + 2})`; ctx.fillRect(x + .7, y + .7, 1024 / 14 - 1.4, 2048 / 40 - 1.4);
    ctx.fillStyle = 'rgba(42,48,45,.09)'; ctx.fillRect(x, y, 1.2, 2048 / 40); ctx.fillRect(x, y, 1024 / 14, 1.2);
  }
  // Very sparse low-contrast aggregate; clean concrete remains dominant.
  for (let i = 0; i < 6000; i++) { ctx.fillStyle = `rgba(38,45,42,${.015 + random() * .035})`; ctx.fillRect(random() * 1024, random() * 2048, 1, 1); }
  const apronTexture = new THREE.CanvasTexture(canvas); apronTexture.colorSpace = THREE.SRGBColorSpace; apronTexture.anisotropy = 8;
  const apronMat = material(0xffffff, .93, 0, { map: apronTexture });
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(222, 640), apronMat);
  apron.name = 'Slabbed concrete apron'; apron.rotation.x = -Math.PI / 2; apron.position.set(201, 9.13, 420); apron.receiveShadow = true; root.add(apron);
  box(68, .12, 90, 73, 9.04, 400, material(0x373d3e, .96), null, false);

  // Taxi guidance, parking lead-ins and vehicle lanes are flush surface marks.
  box(.22, .012, 570, 139, 9.146, 420, m.yellow, null, false);
  box(98, .012, .22, 90, 9.146, 400, m.yellow, null, false);
  for (let i = 0; i < 3; i++) {
    const z = 310 + i * 130;
    box(58, .012, .22, 168, 9.146, z, m.yellow, null, false);
    box(.32, .012, 12, 193, 9.147, z, m.yellow, null, false);
    for (const side of [-1, 1]) box(36, .012, .18, 174, 9.147, z + side * 17, m.white, null, false);
  }
  for (let z = 120; z < 724; z += 16) box(.16, .012, 8, 302, 9.15, z, m.white, null, false);
  for (let x = 60; x < 91; x += 8) {
    box(.22, .014, 22, x, 9.151, 346, m.yellow, null, false);
    box(.22, .014, 22, x, 9.151, 454, m.yellow, null, false);
  }

  // Three hangars face the runway (-X). Their actual open mouths, wall
  // thickness, sliding doors and roof trusses are visible on a low pass.
  for (let hangar = 0; hangar < 3; hangar++) {
    const z = 310 + hangar * 130, x = 250, floor = 9.15, eave = 31.1, peak = 38.3;
    box(80, .55, 92, x, floor + .15, z, m.base);
    box(1.1, 21.8, 90, 289, 20.3, z, m.wall);
    for (const side of [-1, 1]) {
      box(78, 21.8, .8, x, 20.3, z + side * 44.7, m.wall);
      box(79, 2.2, .9, x, 10.4, z + side * 44.8, m.base);
      box(80.8, .7, 1, x, eave, z + side * 46, m.frame);
      // Raised pitched sheet roofs, with real folds at 3.5 metre spacing.
      const slope = Math.atan2(7.2, 46), roofWidth = Math.hypot(46, 7.2);
      box(83, .32, roofWidth, x, (eave + peak) / 2 + .22, z + side * 23, m.roof, [side * slope, 0, 0]);
      for (let rx = 210.5; rx < 292; rx += 3.5) box(.16, .18, roofWidth, rx, (eave + peak) / 2 + .47, z + side * 23, m.rib, [side * slope, 0, 0]);
      // Wall corrugations and downpipes give scale without noisy textures.
      for (let rx = 213; rx < 289; rx += 4.3) box(.15, 20.7, .14, rx, 20.4, z + side * 45.2, m.rib);
      for (const rx of [212, 288]) cylinder(.16, .16, 21, rx, 19.9, z + side * 46.2, m.frame, null, 6);
      // Gable diagonals and fascia connect the doors to the pitched roof.
      for (const fx of [210.1, 289.9]) beam(v(fx, eave, z + side * 45.5), v(fx, peak, z), .7, .6, m.frame);
    }
    box(84, .5, .7, x, peak + .45, z, m.rib);
    // The top gable is physically closed; triangular sheet panels have depth.
    const gable = new THREE.Shape(); gable.moveTo(-44.6, 0); gable.lineTo(44.6, 0); gable.lineTo(0, 7.0); gable.closePath();
    const gableGeometry = new THREE.ExtrudeGeometry(gable, { depth: .45, bevelEnabled: false });
    add(gableGeometry, m.roof, 210.4, eave, z, [0, Math.PI / 2, 0]);
    // Interior receives shadow. Dark paint on rear walls also survives low
    // quality mode, where the renderer intentionally disables shadow maps.
    box(.14, 20, 86, 288.3, 20.2, z, m.interior);
    box(76, .025, 86, x, 9.46, z, m.interior, null, false);
    for (let tx = 212; tx < 289; tx += 19) {
      box(.55, .65, 88, tx, 29.9, z, m.frame);
      for (const side of [-1, 1]) {
        beam(v(tx, 30.2, z + side * 43), v(tx, 37.2, z), .35, .35, m.frame);
        beam(v(tx, 30.2, z + side * 24), v(tx, 34.3, z + side * 24), .24, .24, m.frame);
        box(.6, 20.1, .6, tx, 19.5, z + side * 43.2, m.frame);
      }
    }
    box(1, 1.1, 91, 209.3, 30.5, z, m.frame); // Sliding door rail/header.
    const doorWidth = hangar === 1 ? 43 : 13;
    for (const side of [-1, 1]) {
      const dz = z + side * (44 - doorWidth / 2);
      box(.45, 19.8, doorWidth, 209.45, 19.7, dz, m.roof);
      box(.12, .7, doorWidth, 209.18, 10.3, dz, m.frame);
      for (let pane = -doorWidth / 2 + 1.2; pane < doorWidth / 2; pane += 3.8) {
        box(.12, 19.3, .16, 209.14, 19.7, dz + pane, m.rib);
        box(.05, 1.7, 2.9, 209.13, 25.6, dz + pane + 1.65, m.glass);
      }
    }
    // Door jambs, apron bollards and inset personnel door.
    for (const side of [-1, 1]) {
      box(1.1, 21.6, 1.1, 210.0, 20, z + side * 44, m.frame);
      cylinder(.22, .25, 1.3, 205, 9.9, z + side * 44, m.yellow, null, 8);
    }
    box(.05, 2.6, 1.25, 209.1, 10.8, z + 39.5, m.interior);
    box(.18, .1, .45, 208.98, 10.9, z + 39.8, m.steel);
    box(.4, .25, 2.1, 208.9, 13.2, z + 39.5, m.light);
    // Roof extractors and equipment housings break up the large silhouette.
    for (const rx of [235, 270]) {
      box(3.8, .7, 3.8, rx, peak + .8, z, m.frame);
      cylinder(1.25, 1.5, 1.3, rx, peak + 1.6, z, m.roof, null, 12);
      cylinder(1.65, 1.65, .2, rx, peak + 2.35, z, m.rib, null, 12);
    }
  }

  // Control tower: tapered concrete shaft and an octagonal glazed cabin.
  cylinder(5.8, 7.3, 35.5, 175, 27, 160, m.wall, [0, Math.PI / 4, 0], 4);
  cylinder(8.1, 8.6, 1.1, 175, 9.9, 160, m.base, [0, Math.PI / 4, 0], 4);
  cylinder(12.4, 9.2, 2.7, 175, 45.5, 160, m.frame, null, 8);
  cylinder(12.45, 12.45, 1.15, 175, 47.1, 160, m.interior, null, 8);
  cylinder(13, 12.45, 7.3, 175, 51.2, 160, m.glass, null, 8);
  cylinder(13.9, 13.4, 1.05, 175, 55.35, 160, m.roof, null, 8);
  cylinder(9.8, 13.9, 2.2, 175, 56.95, 160, m.roof, null, 8);
  for (let i = 0; i < 8; i++) {
    const angle = i / 8 * Math.PI * 2;
    beam(v(175 + Math.sin(angle) * 12.5, 47.4, 160 + Math.cos(angle) * 12.5), v(175 + Math.sin(angle) * 13, 55.2, 160 + Math.cos(angle) * 13), .35, .35, m.frame);
  }
  for (let level = 0; level < 5; level++) {
    const y = 15 + level * 5.4, wallX = 175 - (7.3 - (y - 9.25) / 35.5 * 1.5) / Math.SQRT2;
    box(.05, 1.8, 1.05, wallX - .035, y, 159.9, m.glass, [0, 0, -.02987]);
    box(.12, .12, 1.3, wallX - .09, y - 1, 159.9, m.frame);
  }
  cylinder(.12, .28, 13, 175, 64.5, 160, m.steel, null, 8);
  beam(v(172, 66, 160), v(178, 66, 160), .09, .09, m.steel);
  box(.35, .4, .35, 175, 71.2, 160, m.red);
  box(2.4, 3.1, .25, 175, 10.9, 154.83, m.frame);
  box(3.2, .3, 2.3, 175, 9.3, 153.6, m.base);

  // Small operations building: window bays sit behind an actual sun canopy.
  box(53, 10.2, 28, 241, 14.3, 180, m.wall);
  box(55, 1.1, 30, 241, 9.75, 180, m.base);
  box(56, .75, 31, 241, 19.85, 180, m.roof);
  for (let z = 170; z <= 190; z += 5) {
    box(.12, 3.8, 4.1, 214.43, 14.7, z, m.glass);
    box(.22, .18, 4.35, 214.2, 12.65, z, m.frame);
  }
  box(5.4, .35, 27, 212, 17.3, 180, m.roof);
  for (const z of [168, 192]) cylinder(.14, .14, 7.8, 209.7, 13.1, z, m.steel, null, 8);
  for (const x of [231, 248]) {
    box(5, 2.1, 4, x, 21.1, 180, m.wall);
    box(5.5, .25, 4.5, x, 22.3, 180, m.frame);
    for (let j = 0; j < 5; j++) box(.12, 1.6, 4.05, x - 2 + j, 21.1, 180, m.frame);
  }

  // A few service vehicles and equipment provide metre-scale references.
  function serviceVehicle(x, z, tanker = false) {
    const y = Math.max(9.15, heightAt?.(x, z) ?? 9.15);
    box(2.6, .55, tanker ? 7.1 : 4.9, x, y + .72, z, m.frame);
    box(2.55, 1.15, 2.3, x, y + 1.85, z - (tanker ? 2.25 : 1), m.vehicle);
    box(2.35, .95, .07, x, y + 2.2, z - (tanker ? 3.43 : 2.18), m.glass);
    box(2.7, .16, 2.5, x, y + 2.5, z - (tanker ? 2.25 : 1), m.white);
    if (tanker) cylinder(1.13, 1.13, 4.8, x, y + 1.9, z + .9, m.steel, [Math.PI / 2, 0, 0], 16);
    else box(2.5, .85, 2.5, x, y + 1.3, z + 1.35, m.vehicle);
    for (const side of [-1, 1]) for (const axle of [-1.65, tanker ? 2.35 : 1.65]) {
      cylinder(.57, .57, .36, x + side * 1.27, y + .57, z + axle, m.rubber, [0, 0, Math.PI / 2]);
      cylinder(.28, .28, .39, x + side * 1.29, y + .57, z + axle, m.steel, [0, 0, Math.PI / 2]);
    }
    for (const side of [-1, 1]) box(.45, .26, .08, x + side * .88, y + 1.38, z - (tanker ? 3.58 : 2.48), m.light);
  }
  serviceVehicle(193, 223, true); serviceVehicle(195, 679); serviceVehicle(274, 225);
  for (let i = 0; i < 4; i++) {
    box(2.8, 1.1, 1.7, 200, 9.95, 635 + i * 3.5, m.frame);
    for (const side of [-1, 1]) cylinder(.29, .29, .18, 200 + side * 1.25, 9.55, 635 + i * 3.5, m.rubber, [0, 0, Math.PI / 2], 8);
    box(2.7, .2, 1.6, 200, 10.57, 635 + i * 3.5, m.vehicle);
  }
  for (const [x, z] of [[197, 265], [197, 355], [197, 526], [197, 615]]) {
    box(2.1, 1.25, 1.4, x, 9.9, z, m.yellow);
    box(2.25, .12, 1.5, x, 10.6, z, m.frame);
    box(2.2, .25, .08, x, 10.1, z - .75, m.rubber);
  }

  // Shared geometry batches keep this entire architectural kit inexpensive.
  let triangles = 0;
  for (const batch of batches.values()) {
    const count = batch.parts.reduce((sum, part) => sum + part.attributes.position.count, 0);
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
    let offset = 0;
    for (const part of batch.parts) {
      const vertices = part.attributes.position.count;
      positions.set(part.attributes.position.array, offset * 3); normals.set(part.attributes.normal.array, offset * 3); uvs.set(part.attributes.uv.array, offset * 2);
      offset += vertices; part.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, batch.material); mesh.castShadow = batch.cast; mesh.receiveShadow = true;
    mesh.name = `Airport static ${batch.material.color.getHexString()}`; root.add(mesh); triangles += count / 3;
  }
  root.userData.geometryBudget = { triangles: triangles + 2, drawCalls: root.children.length };
  return { root };
}
