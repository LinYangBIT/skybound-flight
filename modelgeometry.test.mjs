import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './dist/vendor/three.module.js';
import { createAircraft } from './dist/aircraft.js';

// Only canvas drawing is inert here. All meshes, batching, transforms and raycasts
// use the game's actual Three.js geometry; this does not stand in for browser QA.
function aircraftGeometry() {
  const previousDocument=globalThis.document;
  const context={
    fillRect(){},fillText(){},strokeRect(){},drawImage(){},save(){},restore(){},
    beginPath(){},rect(){},clip(){},translate(){},rotate(){},moveTo(){},lineTo(){},stroke(){},
    createLinearGradient:()=>({addColorStop(){}}),
  };
  globalThis.document={createElement:()=>({getContext:()=>context})};
  try {
    const model=createAircraft(new THREE.Scene());
    const state={x:0,y:0,z:0,pitch:0,roll:0,heading:0,speed:240,throttle:.82,fuel:100,gear:true,flaps:false};
    model.update(state,0);model.root.updateWorldMatrix(true,true);
    return {model,state};
  } finally {
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
}

function visibleMeshes(root) {
  const meshes=[];root.traverseVisible(object=>{if(object.isMesh)meshes.push(object);});return meshes;
}

function raycast(meshes,origin,direction) {
  return new THREE.Raycaster(new THREE.Vector3(...origin),new THREE.Vector3(...direction).normalize()).intersectObjects(meshes,false)[0];
}

function inspectBothSides(meshes) {
  // Disabling culling is deliberate: inverted faces must fail the normal assertions,
  // rather than disappear and let the test accidentally hit another surface behind.
  const originalSides=new Map();
  for(const mesh of meshes)if(!originalSides.has(mesh.material)) {
    originalSides.set(mesh.material,mesh.material.side);mesh.material.side=THREE.DoubleSide;
  }
  return originalSides;
}

function worldFaceNormal(hit) {
  assert.ok(hit,'expected to intersect actual aircraft geometry');
  return hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
}

test('aircraft batching retains finite geometry, valid indices and unit normals',()=>{
  const {model}=aircraftGeometry();let meshes=0;
  model.root.traverse(object=>{
    if(!object.isMesh)return;meshes++;
    const geometry=object.geometry,positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal');
    for(const attribute of Object.values(geometry.attributes))for(const value of attribute.array)assert.ok(Number.isFinite(value));
    assert.equal(normals.count,positions.count);
    for(let i=0;i<normals.count;i++)assert.ok(Math.abs(Math.hypot(normals.getX(i),normals.getY(i),normals.getZ(i))-1)<1e-5);
    if(geometry.index)for(const index of geometry.index.array)assert.ok(index>=0&&index<positions.count);
  });
  assert.ok(meshes>0);
});

test('nose and inlet lips face outward, and mirrored wings have matching upper and lower surfaces',()=>{
  const {model}=aircraftGeometry();const meshes=visibleMeshes(model.root).filter(mesh=>!mesh.material.transparent);inspectBothSides(meshes);
  const nose=raycast(meshes,[.1,.15,-20],[0,0,1]);
  assert.ok(nose.point.z<-9,'the radome, rather than a rear bulkhead, closes the forward silhouette');
  assert.ok(worldFaceNormal(nose).z<-.2);
  assert.ok(worldFaceNormal(raycast(meshes,[3,0,-8.5],[-1,0,0])).x>.9);
  assert.ok(worldFaceNormal(raycast(meshes,[0,3,-8.5],[0,-1,0])).y>.9);
  for(const [x,z] of [[3,1.1],[4,1.7],[5.6,2.3]]) {
    const top=[],bottom=[];
    for(const side of [-1,1]) {
      top.push(raycast(meshes,[side*x,3,z],[0,-1,0]));bottom.push(raycast(meshes,[side*x,-3,z],[0,1,0]));
    }
    for(const hit of top)assert.ok(worldFaceNormal(hit).y>.9,'upper wing faces should receive sky and sunlight');
    for(const hit of bottom)assert.ok(worldFaceNormal(hit).y<-.9,'underside winding must face down');
    assert.ok(Math.abs(top[0].point.y-top[1].point.y)<1e-6,'mirroring must retain the same non-planar triangulation');
    assert.ok(Math.abs(bottom[0].point.y-bottom[1].point.y)<1e-6);
    assert.ok(top[0].point.y-bottom[0].point.y>.04,'wing retains actual structural thickness');
  }
  for(const side of [-1,1]) {
    const lip=raycast(meshes,[side*1.04,-.075,-6],[0,0,1]);
    assert.ok(lip.point.z>-3.7&&lip.point.z<-3.6);
    assert.ok(worldFaceNormal(lip).z<-.5,'inlet lip must face forward, not disappear behind backface culling');
  }
});

test('exhaust contains an open recessed bore with the correct inner and outer lighting normals',()=>{
  const {model}=aircraftGeometry();const meshes=visibleMeshes(model.root).filter(mesh=>!mesh.material.transparent);const sides=inspectBothSides(meshes);
  for(const side of [-1,1]) {
    const outside=raycast(meshes,[side*.83,3,7.7],[0,-1,0]);
    assert.ok(worldFaceNormal(outside).y>.9);
    const inside=raycast(meshes,[side*.83,0,7.7],[0,1,0]);
    const innerNormal=worldFaceNormal(inside).multiplyScalar(sides.get(inside.object.material)===THREE.BackSide?-1:1);
    assert.ok(innerNormal.y<-.9,'the bore should be lit on its inward-facing wall');
    assert.ok(outside.point.y-inside.point.y>.03,'outer petals and recessed inner duct are distinct surfaces');
    const bore=raycast(meshes,[side*.83,0,10],[0,0,-1]);
    assert.ok(bore.point.z<7,'the nozzle opening must not be covered by a disc at the lip');
  }
});

test('gear remains at runway contact height, retracts from the rendered model, and heading follows flight coordinates',()=>{
  const {model,state}=aircraftGeometry();
  const renderedBounds=()=>{
    const bounds=new THREE.Box3();
    for(const mesh of visibleMeshes(model.root)) {
      mesh.geometry.computeBoundingBox();bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    }
    return bounds;
  };
  assert.ok(Math.abs(renderedBounds().min.y+2.7)<1e-6);
  model.update({...state,gear:false},1);model.root.updateWorldMatrix(true,true);
  assert.ok(renderedBounds().min.y>-1.3,'retracted tyres must not remain in the visible aircraft');
  model.update({...state,x:250,y:140,z:-900,heading:Math.PI/2,gear:false},2);
  assert.deepEqual(model.root.position.toArray(),[250,140,-900]);
  const forward=new THREE.Vector3(0,0,-1).applyQuaternion(model.root.quaternion);
  assert.ok(forward.x>.999&&Math.abs(forward.z)<1e-6);
});

test('cockpit mode hides the external shell, preserves forward visibility and exposes all three live display surfaces',()=>{
  const {model,state}=aircraftGeometry();const exterior=model.root.getObjectByName('Airframe'),cockpit=model.root.getObjectByName('Pilot cockpit');
  model.setCockpit(true);model.update(state,1);model.root.updateWorldMatrix(true,true);
  assert.equal(exterior.visible,false);assert.equal(cockpit.visible,true);
  const opaque=visibleMeshes(model.root).filter(mesh=>!mesh.material.transparent);
  for(const direction of [[0,0,-1],[-.22,0,-1],[.22,0,-1],[0,.13,-1]]) {
    assert.equal(raycast(opaque,model.cockpitViewPoint.toArray(),direction),undefined,'new fittings must not obstruct the pilot forward sightline');
  }
  for(const x of [-.584,0,.584]) {
    const aim=new THREE.Vector3(x,.51,-5.59),direction=aim.clone().sub(model.cockpitViewPoint);
    const hit=raycast(opaque,model.cockpitViewPoint.toArray(),direction.toArray());
    assert.ok(hit&&hit.point.distanceTo(aim)<.01);
    assert.ok(hit.object.material.isMeshBasicMaterial&&hit.object.material.map,'the display, not an opaque new bezel, must be visible');
  }
  model.setCockpit(false);assert.equal(exterior.visible,true);assert.equal(cockpit.visible,false);
});
