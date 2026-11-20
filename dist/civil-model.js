import * as THREE from './vendor/three.module.js';
import { batchStaticMeshes } from './aircraft-surfaces.js?v=5';
import { DOOR, BRIDGE_BASE } from './civil-operations.js?v=5';

// A fictional regional airliner, in metres. Aircraft forward is local -Z.
export function createCivilModel(scene) {
  const root=new THREE.Group(), exterior=new THREE.Group(), cabin=new THREE.Group();
  const airport=new THREE.Group(), bridge=new THREE.Group(), tug=new THREE.Group();
  root.name='QY-28 regional airliner';airport.name='Qingyu passenger gate C2';
  scene.add(root,airport);root.add(exterior,cabin);airport.add(bridge,tug);
  const paint=(color,roughness=.65,metalness=.1)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const white=paint(0xd8dedc,.41,.17), teal=paint(0x164955,.42,.22), amber=paint(0xdba44c,.54), silver=paint(0x8a969a,.30,.71), frame=paint(0x566269), window=paint(0x263a41,.21,.32), tyre=paint(0x25292b,.94), floor=paint(0x727773,.9);
  const put=(parent,g,m,x=0,y=0,z=0)=>{const mesh=new THREE.Mesh(g,m);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
  const box=(parent,m,x,y,z,w,h,d)=>put(parent,new THREE.BoxGeometry(w,h,d),m,x,y,z);
  const ell=(parent,m,x,y,z,a,b,c)=>{const mesh=put(parent,new THREE.SphereGeometry(1,24,14),m,x,y,z);mesh.scale.set(a,b,c);return mesh;};
  const pipe=(parent,m,x,y,z,r1,r2,h,n=16)=>put(parent,new THREE.CylinderGeometry(r1,r2,h,n),m,x,y,z);
  const beam=(parent,m,from,to,w,d)=>{
    const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),line=b.clone().sub(a);
    const center=a.clone().lerp(b,.5),mesh=box(parent,m,center.x,center.y,center.z,w,line.length(),d);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),line.normalize());return mesh;
  };
  function bodyShell() {
    // Each station is z, half-width, vertical radius, and centre height.
    const stations=[[-14.1,.05,.07,-.05],[-13.6,.54,.46,.04],[-12.9,.94,.79,.12],[-12,1.22,1.07,.20],[-10.8,1.44,1.36,.26],[-9.5,1.54,1.55,.25],[-7.2,1.59,1.64,.20],[5.6,1.59,1.64,.20],[8.1,1.46,1.54,.30],[10.5,1.08,1.19,.59],[12.6,.57,.70,.88],[14.6,.07,.1,1.12]];
    const vertices=[],idx=[],colors=[],count=48;
    for(let j=0;j<stations.length;j++){
      const [z,rx,ry,cy]=stations[j];
      for(let i=0;i<count;i++){
        const theta=i*Math.PI*2/count,ny=Math.sin(theta);
        vertices.push(Math.cos(theta)*rx,cy+ny*ry,z);
        // Livery follows the body and turns upward into a coloured tail.
        const sill=-.55+Math.max(0,z-5)*.13;
        const color=ny<sill?teal.color:ny<sill+.10?amber.color:white.color;
        colors.push(color.r,color.g,color.b);
        if(j<stations.length-1){const a=j*count+i,b=j*count+(i+1)%count;idx.push(a,b,a+count,b,b+count,a+count);}
      }
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(idx);g.computeVertexNormals();
    return put(exterior,g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.42,metalness:.20}));
  }
  const shell=bodyShell();
  // Sloped wrap-around cockpit glazing is inset into the distinct nose profile.
  ell(exterior,window,0,.89,-11.55,1.20,.53,1.42);
  for(const side of [-1,1])beam(exterior,white,[side*.40,1.23,-12.48],[side*.51,1.4,-11.52],.075,.065);
  const portholes=[];
  for(const side of [-1,1])for(let i=0;i<17;i++)portholes.push([side*1.53,.74,-7.0+i*.76]);
  const windows=new THREE.InstancedMesh(new THREE.SphereGeometry(1,10,8),window,portholes.length),object=new THREE.Object3D();
  portholes.forEach(([x,y,z],i)=>{object.position.set(x,y,z);object.scale.set(.066,.225,.17);object.updateMatrix();windows.setMatrixAt(i,object.matrix);});exterior.add(windows);
  for(const side of [-1,1]){
    // Door frames double as visual alignment references for the passenger bridge.
    box(exterior,frame,side*1.45,.49,-8,.08,1.97,.96);
    box(exterior,white,side*1.50,.49,-8,.055,1.85,.84);
    box(exterior,window,side*1.54,.94,-8,.04,.29,.27);
  }
  function aeroSurface(parent,outline,thickness,material){
    const points=outline.map(([x,y,z])=>new THREE.Vector2(x,z)), faces=THREE.ShapeUtils.triangulateShape(points,[]),n=outline.length;
    const data=[],indices=[];
    for(const dy of [thickness/2,-thickness/2])for(const [x,y,z] of outline)data.push(x,y+dy,z);
    for(const [a,b,c] of faces){indices.push(a,c,b,n+a,n+b,n+c);}
    for(let i=0;i<n;i++){const j=(i+1)%n;indices.push(i,j,i+n,j,j+n,i+n);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(data,3));g.setIndex(indices);g.computeVertexNormals();
    material.side=THREE.DoubleSide;return put(parent,g,material);
  }
  const wingMat=paint(0xbdc7c7,.51,.28),edgeMat=paint(0x96a6a8,.43,.44);
  for(const side of [-1,1]) {
    const wing=[[1.05,-.60,-2.5],[5.4,-.25,-.75],[12.9,.91,2.9],[13.02,1.05,3.55],[5.65,-.16,2.50],[2.1,-.47,3.70],[1.02,-.60,3.78]].map(([x,y,z])=>[side*x,y,z]);
    aeroSurface(exterior,wing,.17,wingMat);
    aeroSurface(exterior,[[12.48,.83,2.7],[13.68,2.75,3.2],[13.82,2.86,3.5],[13.05,1.01,3.62]].map(([x,y,z])=>[side*x,y,z]),.075,teal);
    aeroSurface(exterior,[[.42,1.00,8.61],[4.8,1.49,10.86],[5.25,1.59,11.45],[4.97,1.50,11.83],[.60,1.04,10.92]].map(([x,y,z])=>[side*x,y,z]),.12,wingMat);
    beam(exterior,edgeMat,[side*1.5,-.42,3.31],[side*5.0,-.16,2.39],.053,.052);
    // High-bypass turbofan: projecting inlet lip, recessed fan and rear nozzle.
    box(exterior,wingMat,side*4.2,-.64,-.22,.36,.72,1.9);
    const motor=pipe(exterior,white,side*4.2,-1.16,-.82,.79,.68,2.84,32);motor.rotation.x=Math.PI/2;
    put(exterior,new THREE.TorusGeometry(.70,.082,10,36),silver,side*4.2,-1.16,-2.26);
    const disk=pipe(exterior,tyre,side*4.2,-1.16,-2.24,.65,.64,.11,30);disk.rotation.x=Math.PI/2;
    const cone=pipe(exterior,silver,side*4.2,-1.16,-2.31,.03,.16,.17,14);cone.rotation.x=-Math.PI/2;
    const nozzle=pipe(exterior,frame,side*4.2,-1.16,.81,.45,.55,.56,24);nozzle.rotation.x=Math.PI/2;
  }
  const tail=new THREE.Shape();tail.moveTo(0,0);tail.lineTo(2.8,4.72);tail.lineTo(4.14,4.95);tail.lineTo(4.46,4.75);tail.lineTo(3.7,.92);tail.lineTo(5.15,0);tail.closePath();
  const fin=new THREE.ExtrudeGeometry(tail,{depth:.16,bevelEnabled:true,bevelThickness:.04,bevelSize:.035,bevelSegments:2});fin.rotateY(-Math.PI/2);put(exterior,fin,teal,.08,1.31,8.29);
  const gear=new THREE.Group();exterior.add(gear);
  for(const [x,z,r] of [[-2.26,1.39,.46],[2.26,1.39,.46],[0,-8.58,.36]]){
    const axle=-2.7+r;pipe(gear,silver,x,(axle-.64)/2,z,.093,.09,-axle-.64,12);
    for(const sign of [-1,1]){const w=pipe(gear,tyre,x+sign*.19,axle,z,r,r,.21,18);w.rotation.z=Math.PI/2;}
  }
  const cockpitViewPoint=new THREE.Vector3(0,1.34,-11.03);
  // Independent wide crew panel: indicated speed and altitude are live.
  box(cabin,tyre,0,.82,-12.08,2.38,.77,.28);
  box(cabin,frame,0,1.13,-12.15,2.46,.10,.48);
  for(const side of [-1,1])beam(cabin,frame,[side*1.12,.94,-11.62],[side*.82,2.05,-11.92],.085,.10);
  const instrumentCanvas=document.createElement('canvas');instrumentCanvas.width=512;instrumentCanvas.height=144;
  const ctx=instrumentCanvas.getContext('2d'),screenTexture=new THREE.CanvasTexture(instrumentCanvas);screenTexture.colorSpace=THREE.SRGBColorSpace;
  put(cabin,new THREE.PlaneGeometry(1.97,.46),new THREE.MeshBasicMaterial({map:screenTexture}),0,.83,-11.925);
  let lastPaint=-1;
  function drawScreen(state){
    ctx.fillStyle='#171f22';ctx.fillRect(0,0,512,144);
    for(let i=0;i<3;i++){ctx.fillStyle='#091214';ctx.fillRect(6+168*i,6,162,132);}
    ctx.fillStyle='#98c1b2';ctx.font='16px monospace';ctx.fillText('AIR DATA',18,35);ctx.fillText('ALTITUDE',186,35);ctx.fillText('ENG  1 / 2',354,35);
    ctx.fillStyle='#e4eee6';ctx.font='26px monospace';ctx.fillText(`${Math.round(state.speed*3.6)}`,18,84);ctx.fillText(`${Math.round(state.y*3.28084)}`,186,84);ctx.fillText(`${Math.round(state.throttle*100)} %`,354,84);
    ctx.fillStyle='#8fb1a8';ctx.font='15px monospace';ctx.fillText('KM/H',18,119);ctx.fillText('FT MSL',186,119);ctx.fillText('N1',354,119);screenTexture.needsUpdate=true;
  }
  // Dedicated passenger terminal south of the maintenance hangars.
  box(airport,floor,280,14.9,684,45,11.5,58);
  box(airport,window,256.9,16.1,684,.6,5.5,54);
  for(let z=658;z<713;z+=5.2)box(airport,frame,256.4,16.1,z,.45,5.7,.21);
  box(airport,white,280,21.3,684,49,.68,62);
  box(airport,teal,257,19.7,683,.60,.84,58);
  const signCanvas=document.createElement('canvas');signCanvas.width=128;signCanvas.height=64;const logo=signCanvas.getContext('2d');
  logo.fillStyle='#252b29';logo.fillRect(0,0,128,64);logo.fillStyle='#ffdd77';logo.font='bold 48px sans-serif';logo.fillText('C2',28,49);
  const label=new THREE.CanvasTexture(signCanvas);label.colorSpace=THREE.SRGBColorSpace;
  const marker=put(airport,new THREE.PlaneGeometry(4.5,2.25),new THREE.MeshBasicMaterial({map:label}),256.0,18.5,692);marker.rotation.y=-Math.PI/2;
  for(const [x,z,w,d] of [[185,703,80,.23],[225,703,.28,9],[171,709,.27,34],[139,542,.23,210]])box(airport,amber,x,9.16,z,w,.015,d);
  bridge.position.set(BRIDGE_BASE.x,BRIDGE_BASE.y,BRIDGE_BASE.z);
  pipe(bridge,white,0,0,0,1.68,1.68,2.52,20);
  const tunnel=new THREE.Group();bridge.add(tunnel);
  box(tunnel,teal,0,-.76,.5,1.95,.31,1);
  box(tunnel,white,0,.99,.5,2.18,.19,1);
  for(const side of [-1,1])box(tunnel,window,side*.99,.13,.50,.10,1.65,1);
  for(let section=0;section<12;section++)for(const side of [-1,1])box(tunnel,silver,side*1.02,.13,section/12, .13,1.68,.010);
  const cab=new THREE.Group();cab.name='Passenger bridge cab';bridge.add(cab);
  box(cab,frame,0,.04,-.89,2.3,2.49,1.55);box(cab,tyre,0,.04,-.14,2.46,2.53,.28);
  pipe(cab,frame,0,-1.9,-.7,.20,.3,1.68);for(const side of [-1,1]){const tire=pipe(cab,tyre,side*.62,-2.57,-.7,.40,.40,.22,12);tire.rotation.z=Math.PI/2;}
  // Tug facing into the nose gear, with a visible drawbar during pushback.
  box(tug,amber,0,.72,0,1.91,.82,3.20);box(tug,window,0,1.37,-.36,1.34,.73,1.07);box(tug,white,0,1.80,-.36,1.58,.12,1.28);
  for(const x of [-.97,.97])for(const z of [-.96,.96]){const w=pipe(tug,tyre,x,.42,z,.42,.42,.28,14);w.rotation.z=Math.PI/2;}
  const bar=box(tug,silver,0,.55,3.2,.13,.15,3.6);
  batchStaticMeshes(gear);
  batchStaticMeshes(exterior,[shell,gear]); // Keep the fuselage vertex-colour livery.
  batchStaticMeshes(cabin);
  batchStaticMeshes(tunnel);
  batchStaticMeshes(cab);
  batchStaticMeshes(tug,[bar]);
  batchStaticMeshes(airport,[bridge,tug]);
  const noseOffset=new THREE.Vector3();
  let lastBridgeExtension=NaN;
  function updateGround(op){
    airport.visible=!!op;if(!op)return;
    const extension=op.bridge;
    if(extension!==lastBridgeExtension){
      const endX=THREE.MathUtils.lerp(-8,DOOR.x-BRIDGE_BASE.x,extension);
      const endZ=THREE.MathUtils.lerp(3,DOOR.z-BRIDGE_BASE.z,extension);
      tunnel.rotation.y=Math.atan2(endX,endZ);tunnel.scale.z=Math.hypot(endX,endZ);
      cab.position.set(endX,0,endZ);lastBridgeExtension=extension;
    }
    const attached=op.phase==='gate'||op.phase==='disconnect'||op.phase==='pushback';
    bar.visible=attached;tug.visible=op.entry==='departure' && (attached||op.phase==='taxiOut');
    if(!tug.visible)return;
    if(attached){const f=noseOffset.set(0,0,-14.5).applyQuaternion(root.quaternion);tug.position.set(root.position.x+f.x,9.15,root.position.z+f.z);tug.rotation.y=root.rotation.y;}
    else {const depart=op.tugDeparture;tug.position.set(168+depart*22,9.15,718.5-depart*15);tug.rotation.y=-depart*Math.PI/2;}
  }
  function update(state,time,gearDown=state.gear){
    root.position.set(state.x,state.y,state.z);root.rotation.set(state.pitch,-state.heading,-state.roll,'YXZ');gear.visible=gearDown;
    if(cabin.visible && (time-lastPaint>.15||time<lastPaint)){drawScreen(state);lastPaint=time;}
  }
  function setCockpit(enabled){exterior.visible=!enabled;cabin.visible=enabled;}
  setCockpit(false);root.visible=false;airport.visible=false;
  return {root,cockpitViewPoint,update,updateGround,setCockpit,setVisible(value){root.visible=value;if(!value)airport.visible=false;}};
}
