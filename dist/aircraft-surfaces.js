import * as THREE from './vendor/three.module.js';

// Original, repeatable aircraft finishes. Colour is sRGB; surface data stays linear.
// Wear follows access panels and the airflow, leaving most of the painted skin clean.
function skinMaps(wing = false) {
  const canvases = Array.from({length:3}, () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024; return canvas;
  });
  const [colour, roughness, relief] = canvases.map(canvas => canvas.getContext('2d'));
  colour.fillStyle = '#aeb7ba'; colour.fillRect(0,0,1024,1024);
  roughness.fillStyle = '#bababa'; roughness.fillRect(0,0,1024,1024);
  relief.fillStyle = '#808080'; relief.fillRect(0,0,1024,1024);
  const panels = wing
    ? [[45,118,252,205],[316,118,360,205],[696,118,280,205],[45,344,415,306],[482,344,494,306],[45,672,296,286],[365,672,611,286]]
    : [[32,36,218,254],[272,36,480,254],[774,36,218,254],[32,313,330,310],[385,313,368,310],[775,313,217,310],[32,646,218,342],[272,646,480,342],[774,646,218,342]];
  panels.forEach(([x,y,w,h], index) => {
    colour.fillStyle = index % 3 === 0 ? '#a5b0b3' : '#b2bbbd'; colour.fillRect(x+3,y+3,w-6,h-6);
    colour.strokeStyle = 'rgba(41,57,64,.50)'; colour.lineWidth = 1.25; colour.strokeRect(x,y,w,h);
    colour.strokeStyle = 'rgba(225,231,229,.40)'; colour.lineWidth = 1; colour.strokeRect(x+2,y+2,w-4,h-4);
    roughness.fillStyle = index % 3 === 0 ? '#c0c0c0' : '#b7b7b7'; roughness.fillRect(x,y,w,h);
    roughness.strokeStyle = '#969696'; roughness.lineWidth = 5; roughness.strokeRect(x+2,y+2,w-4,h-4);
    relief.strokeStyle = '#565656'; relief.lineWidth = 1.7; relief.strokeRect(x,y,w,h);
    // Flush fasteners belong to the panel borders, rather than a noise layer.
    colour.fillStyle = 'rgba(48,63,68,.48)'; relief.fillStyle = '#6a6a6a';
    for(let offset=14; offset<w-9; offset+=31) for(const py of [y+7,y+h-7]) {
      colour.fillRect(x+offset,py,1.6,1.6); relief.fillRect(x+offset,py,1.6,1.6);
    }
    for(let offset=14; offset<h-9; offset+=31) for(const px of [x+7,x+w-7]) {
      colour.fillRect(px,y+offset,1.6,1.6); relief.fillRect(px,y+offset,1.6,1.6);
    }
    // Small aft-running stains only behind a few serviced panel fasteners.
    if(index===2||index===5) for(let i=0;i<5;i++) {
      const sx=x+22+i*(w-40)/5;
      const stain=colour.createLinearGradient(sx,y+h-2,sx,y+h+26);
      stain.addColorStop(0,'rgba(47,57,57,.11)'); stain.addColorStop(1,'rgba(47,57,57,0)');
      colour.fillStyle=stain; colour.fillRect(sx,y+h-2,3,28);
    }
  });
  colour.fillStyle='#4b5b60'; colour.font='12px monospace'; colour.fillText('NO STEP',wing?500:397,wing?703:675);
  const textures=canvases.map((canvas,index)=>{
    // Only the albedo needs 1K markings; half-size data maps keep the mobile budget modest.
    if(index>0){const data=document.createElement('canvas');data.width=data.height=512;data.getContext('2d').drawImage(canvas,0,0,512,512);canvas=data;}
    const texture=new THREE.CanvasTexture(canvas);texture.anisotropy=index===0?8:4;return texture;
  });
  textures[0].colorSpace=THREE.SRGBColorSpace;
  return {map:textures[0],roughnessMap:textures[1],bumpMap:textures[2],bumpScale:.0035};
}

export function createAirframeMaterials() {
  const body = skinMaps(false), wing = skinMaps(true);
  const physical = (color, extra={}) => new THREE.MeshPhysicalMaterial({color,roughness:.67,metalness:.12,clearcoat:.18,clearcoatRoughness:.38,...extra});
  const standard = (color, extra={}) => new THREE.MeshStandardMaterial({color,roughness:.56,metalness:.2,...extra});
  return {
    bodyPaint:physical(0xffffff,body), wingPaint:physical(0xffffff,wing),
    darkPaint:physical(0x66757c,{roughness:.62}),
    nosePaint:standard(0x737f85,{roughness:.7,metalness:0}),
    black:standard(0x080d10,{roughness:.88,metalness:0}),
    rubber:standard(0x15191b,{roughness:.94,metalness:0}),
    metal:standard(0xa5aeb2,{roughness:.27,metalness:.92}),
    hotMetal:standard(0x655e58,{roughness:.43,metalness:.88}),
    hotEdge:standard(0x8b8c87,{roughness:.31,metalness:.9}),
    hotInner:standard(0x302b29,{roughness:.75,metalness:.62,side:THREE.BackSide}),
    glass:new THREE.MeshPhysicalMaterial({color:0x789199,roughness:.07,metalness:0,clearcoat:1,clearcoatRoughness:.035,transparent:true,opacity:.50,envMapIntensity:.9,depthWrite:false}),
    navRed:new THREE.MeshBasicMaterial({color:0xff5d49}),
    navGreen:new THREE.MeshBasicMaterial({color:0x7be7b4}),
  };
}

// Merge static pieces by finish, preserving separate moving assemblies and transparent glass.
// This keeps close-view rivets, brake lines and cockpit bezels from becoming hundreds of draws.
export function batchStaticMeshes(parent, excluded = []) {
  parent.updateWorldMatrix(true,true);
  const inverse = parent.matrixWorld.clone().invert(), batches = new Map(), removals=[];
  function collect(object) {
    if(excluded.includes(object)) return;
    if(object.isMesh && !object.isInstancedMesh && !Array.isArray(object.material) && !object.material.transparent && !object.material.isShaderMaterial) {
      const material=object.material;
      if(!batches.has(material)) batches.set(material,{positions:[],normals:[],uvs:[],indices:[],cast:false,receive:false});
      const batch=batches.get(material), geometry=object.geometry;
      const positions=geometry.getAttribute('position'), normals=geometry.getAttribute('normal'), uvs=geometry.getAttribute('uv');
      const transform=new THREE.Matrix4().multiplyMatrices(inverse,object.matrixWorld);
      const normalTransform=new THREE.Matrix3().getNormalMatrix(transform);
      const vector=new THREE.Vector3(), offset=batch.positions.length/3;
      for(let i=0;i<positions.count;i++) {
        vector.fromBufferAttribute(positions,i).applyMatrix4(transform); batch.positions.push(vector.x,vector.y,vector.z);
        if(normals) vector.fromBufferAttribute(normals,i).applyMatrix3(normalTransform).normalize(); else vector.set(0,1,0);
        batch.normals.push(vector.x,vector.y,vector.z); batch.uvs.push(uvs?uvs.getX(i):0,uvs?uvs.getY(i):0);
      }
      if(geometry.index) for(let i=0;i<geometry.index.count;i++) batch.indices.push(offset+geometry.index.getX(i));
      else for(let i=0;i<positions.count;i++) batch.indices.push(offset+i);
      batch.cast ||= object.castShadow; batch.receive ||= object.receiveShadow; removals.push(object);
    }
    for(const child of object.children) collect(child);
  }
  for(const child of parent.children) collect(child);
  for(const object of removals) object.removeFromParent();
  for(const [material,batch] of batches) {
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(batch.positions,3));
    geometry.setAttribute('normal',new THREE.Float32BufferAttribute(batch.normals,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(batch.uvs,2)); geometry.setIndex(batch.indices);
    geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,material); mesh.name='Batched aircraft finish'; mesh.castShadow=batch.cast; mesh.receiveShadow=batch.receive; parent.add(mesh);
  }
}
