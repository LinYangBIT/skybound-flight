import * as THREE from './vendor/three.module.js';
import { createFlight } from './physics.js?v=5';
import { RUNWAY_ELEVATION, RUNWAY_HALF_LENGTH, RUNWAY_HALF_WIDTH, runwayAt } from './airfield.js?v=5';

// Coordinates are metres in the fictional Qingyu training area. The flight and
// landing lessons can also be entered independently from the school menu.
const gates = [
  {id:'city', name:'港城楼间航道', x:430,y:145,z:-2460, radius:135, halfHeight:87},
  {id:'pass', name:'双峰山口', x:650,y:330,z:-4380, radius:225, halfHeight:145},
  {id:'cloud', name:'穿越云层', x:950,y:600,z:-5630, radius:400, halfHeight:135},
  {id:'cruise', name:'爬升至巡航高度', x:1370,y:850,z:-6740, radius:580, halfHeight:115},
  {id:'turn', name:'右转返航', x:3850,y:820,z:-6900, radius:580, halfHeight:240},
  {id:'downwind', name:'沿东岸下风边飞行', x:4780,y:630,z:-1400, radius:600, halfHeight:240},
  {id:'base', name:'转入基地边', x:3860,y:380,z:4700, radius:520, halfHeight:170},
  {id:'lineup', name:'南侧对正跑道', x:0,y:180,z:4900, radius:400, halfHeight:105},
  {id:'final', name:'最后进近', x:0,y:90,z:3350, radius:210, halfHeight:65},
];
const touchdown = {id:'land',name:'跑道接地区', x:0,y:RUNWAY_ELEVATION+2.8,z:1150,radius:36,halfHeight:23};
export const FIGHTER_ROUTE = Object.freeze(gates.map(g=>Object.freeze({...g})));
const byId = new Map([...FIGHTER_ROUTE,touchdown].map(g=>[g.id,g]));
const sequence = ['takeoff','city','pass','cloud','cruise','level','turn','downwind','base','lineup','final','land','stop','done'];
const clamp=(v,l,h)=>Math.min(h,Math.max(l,v));
const feet = y=>Math.round(y*3.28084/10)*10;
const angleDifference=a=>Math.atan2(Math.sin(a),Math.cos(a));
const stageOf=id=>id==='takeoff'?1:sequence.indexOf(id)<=sequence.indexOf('level')?2:3;
const headings = ['','起飞与爬升','穿越与巡航','进近与着陆'];

export function createFighterCourse(entry='takeoff') {
  const step=entry==='landing'?'land':entry==='flight'?'city':'takeoff';
  return {entry,step,checkpoint:step==='land'?'landing':step==='city'?'flight':'takeoff',complete:false,failed:false,reason:'',hold:0};
}
export function fighterSpawn(entry='takeoff') {
  if(entry==='flight') return {...createFlight({airborne:true}),x:230,y:133,z:-1050,heading:.14,speed:145,throttle:.54};
  if(entry==='landing') return {...createFlight({airborne:true}),x:0,y:51,z:2360,heading:0,speed:72,throttle:.43,gear:true,flaps:true};
  return createFlight();
}

// Paired quays flank a clear flight corridor. The same bounds used to model
// the towers drive swept collision detection, including lateral fly-bys.
const buildings=[];
for(const side of [-1,1]) for(let row=0;row<6;row++) for(let col=0;col<3;col++){
  const seed=row*31+col*11+(side>0?7:0);
  const width=38+seed%15, depth=44+seed%18;
  buildings.push({x:430+side*(169+col*83+(row%2)*11),z:-2460+(row-2.5)*94,base:6,width,depth,height:112+((seed*47)%142)});
}
const quays=[-1,1].map(side=>({x:430+side*262,z:-2460,base:-2,width:269,depth:642,height:8}));
const citySolids=[...quays,...buildings];
function boxHit(a,b,box) {
  let first=0,last=1;
  for(const [key,lo,hi] of [['x',box.x-box.width/2-5,box.x+box.width/2+5],['y',box.base-1.5,box.base+box.height+1.5],['z',box.z-box.depth/2-4,box.z+box.depth/2+4]]){
    const delta=b[key]-a[key];
    if(Math.abs(delta)<1e-8){if(a[key]<lo||a[key]>hi)return false;continue;}
    const p=(lo-a[key])/delta,q=(hi-a[key])/delta;
    first=Math.max(first,Math.min(p,q));last=Math.min(last,Math.max(p,q));
    if(first>last)return false;
  }
  return true;
}

// Actual coastal ridges flank the second gate. Render and collision sample
// the same two triangles in each grid cell, even near the tapered tips.
const ridges=[];
for(const side of [-1,1]){
  const nx=32,nz=40,width=1240,length=1690,left=650+side*790-width/2,near=-4380-length/2;
  const heights=new Float32Array((nx+1)*(nz+1));
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
    const x=i/nx*2-1,z=j/nz*2-1;
    const spine=.27*Math.sin(z*4.1+side)+.11*Math.sin(z*7.5);
    const envelope=Math.max(0,1-z*z)**1.2*Math.max(0,1-x*x)**.8;
    const peak=Math.max(0,1-Math.abs(x-spine)*1.36);
    const stone=Math.sin(i*.67+j*.37)*Math.cos(j*.72-i*.22);
    heights[j*(nx+1)+i]=envelope*(82+peak*(420+68*Math.cos(z*5+side))+stone*31)-3;
  }
  ridges.push({nx,nz,width,length,left,near,heights});
}
function ridgeHeight(r,x,z){
  const u=(x-r.left)/r.width*r.nx,v=(z-r.near)/r.length*r.nz;
  if(u<0||u>=r.nx||v<0||v>=r.nz)return -3;
  const i=Math.floor(u),j=Math.floor(v),s=u-i,t=v-j,k=j*(r.nx+1)+i,h=r.heights;
  const a=h[k],b=h[k+1],c=h[k+r.nx+1],d=h[k+r.nx+2];
  return s+t<=1?a+(b-a)*s+(c-a)*t:d+(c-d)*(1-s)+(b-d)*(1-t);
}
function obstacle(a,b){
  if(Math.min(a.z,b.z)<-2120&&Math.max(a.z,b.z)>-2800&&citySolids.some(box=>boxHit(a,b,box)))return '碰到港区建筑。下次沿两排楼之间的航标飞行。';
  if(Math.min(a.z,b.z)<-3500&&Math.max(a.z,b.z)>-5300){
    const samples=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/12));
    for(let i=1;i<=samples;i++){
      const t=i/samples,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,z=a.z+(b.z-a.z)*t;
      if(ridges.some(r=>ridgeHeight(r,x,z)+2>y))return '碰到山坡。下次提前爬升，沿双峰之间的缺口飞行。';
    }
  }
  return '';
}
const startPosition={x:0,z:1500};
function gateHeading(gate){
  const index=FIGHTER_ROUTE.indexOf(gate),prev=FIGHTER_ROUTE[index-1]||startPosition;
  return Math.atan2(gate.x-prev.x,prev.z-gate.z);
}
function crossesGate(a,b,g){
  const angle=gateHeading(g),sx=Math.sin(angle),cz=Math.cos(angle);
  const signed=p=>(p.x-g.x)*sx-(p.z-g.z)*cz;
  const before=signed(a),after=signed(b);
  if(before*after>0||before===after)return false;
  const t=before/(before-after);
  const lateral=((a.x+(b.x-a.x)*t-g.x)*cz+(a.z+(b.z-a.z)*t-g.z)*sx)/g.radius;
  const vertical=(a.y+(b.y-a.y)*t-g.y)/g.halfHeight;
  return lateral*lateral+vertical*vertical<=1;
}
function reaches(a,b,g){
  if(['city','pass','cloud'].includes(g.id))return crossesGate(a,b,g);
  // The waypoint ellipsoid matches each gate's generous horizontal and
  // tighter altitude tolerance. Sweep the segment so high speed cannot skip it.
  const x=(a.x-g.x)/g.radius,y=(a.y-g.y)/g.halfHeight,z=(a.z-g.z)/g.radius;
  const dx=(b.x-a.x)/g.radius,dy=(b.y-a.y)/g.halfHeight,dz=(b.z-a.z)/g.radius;
  const t=clamp(-(x*dx+y*dy+z*dz)/(dx*dx+dy*dy+dz*dz||1),0,1);
  return (x+dx*t)**2+(y+dy*t)**2+(z+dz*t)**2<=1;
}
function fail(course,reason){course.failed=true;course.reason=reason;return reason;}
function advance(course,step){
  course.step=step;
  if(step==='city')course.checkpoint='flight';
  if(step==='turn')course.checkpoint='landing';
  if(step==='done')course.complete=true;
  return step==='level'?'已穿云，保持平飞 3 秒。':step==='turn'?'巡航高度已稳定，现在右转返场。':step==='stop'?'平稳接地，保持中线刹车。':step==='done'?'已平稳降落并停稳。':`下一项 · ${byId.get(step)?.name||'起飞'}`;
}
export function stepFighterCourse(course,previous,state,dt){
  if(course.complete||course.failed)return null;
  if(state.crashed)return fail(course,state.crashReason||'飞行中断');
  const hit=obstacle(previous,state);
  if(hit)return fail(course,hit);
  if(Math.hypot(state.x,state.z)>19500)return fail(course,'已离开教学空域，可从本阶段重新练习。');
  if(course.step==='takeoff'){
    if(!state.grounded&&state.y>=32)return advance(course,'city');
    return null;
  }
  if(course.step==='stop'){
    if(!state.grounded)return advance(course,'land');
    if(state.speed<=1&&state.landed&&runwayAt(state.x,state.z))return advance(course,'done');
    return null;
  }
  if(state.grounded&&state.landed){
    if(course.step==='land'&&runwayAt(state.x,state.z)&&state.gear&&state.landingRate>-5&&Math.abs(state.roll)<.25)return advance(course,'stop');
    return fail(course,'提前着陆，尚未完成当前教学航段。');
  }
  if(course.step==='land'){
    // Missing the runway leaves the aircraft live and gives a valid new circuit.
    if(state.z<250-RUNWAY_HALF_LENGTH&&!state.grounded){
      advance(course,'downwind');
      return '复飞。加油门爬升，沿东岸航标重新进近。';
    }
    return null;
  }
  if(course.step==='level'){
    if(Math.abs(state.y-850)<130&&Math.abs(state.verticalSpeed)<16&&Math.abs(state.roll)<.40)course.hold+=clamp(dt,0,.1);
    else course.hold=0;
    return course.hold>=3?advance(course,'turn'):null;
  }
  const g=byId.get(course.step);
  if(g&&reaches(previous,state,g))return advance(course,sequence[sequence.indexOf(course.step)+1]);
  return null;
}

export function fighterLessonInput(course,state,controls){
  if(course.step!=='land'||controls.assist===false||state.grounded||state.y>110||state.speed>105||controls.pitch>=0)return controls;
  const maxDescent=state.y<24?2.1:4.1;
  const limit=-Math.asin(Math.min(.99,maxDescent/(Math.max(state.speed,50)*.90)))/.62;
  return {...controls,pitch:Math.max(controls.pitch,limit)};
}
export function fighterGuidance(course,state){
  const id=course.step,stage=stageOf(id);
  let target=byId.get(id)||null;
  if(id==='land'&&state.z<touchdown.z+350)target={...touchdown,z:Math.max(-RUNWAY_HALF_LENGTH,state.z-350),name:'跑道中线'};
  const distance=target?Math.hypot(target.x-state.x,target.z-state.z):0;
  const radians=target?Math.atan2(target.x-state.x,state.z-target.z):state.heading;
  const bearing=(Math.round(radians*180/Math.PI)+360)%360;
  const turn=angleDifference(radians-state.heading)*180/Math.PI;
  const steer=Math.abs(turn)<7?'保持航向':`${turn<0?'左':'右'}转 ${Math.round(Math.abs(turn))}°`;
  const alt=target?`目标 ${feet(target.y)} FT`:'';
  let title=target?.name||'',hint='';
  if(id==='takeoff'){
    title=state.grounded?'从跑道起飞':'建立爬升';
    hint=state.grounded?(state.speed<58?'推满油门（Shift / 油门滑块），保持跑道中线。':'已到抬轮速度。按 S / ↓ 或「抬头」离地。'):'保持抬头，飞过 105 FT 后松开。';
  }else if(id==='level'){
    title='稳定巡航';hint=`保持约 2,790 FT，松开俯仰并改平机翼 ${Math.min(3,course.hold).toFixed(1)} / 3 秒。`;
  }else if(id==='land'){
    title='对正跑道，平稳降落';
    const landingTrack=angleDifference(-state.heading);
    if(Math.abs(state.x)>RUNWAY_HALF_WIDTH||Math.abs(landingTrack)>.29)hint=`${steer}，对正中线至航向 000°。偏差太大时爬升复飞。`;
    else if(!state.gear||!state.flaps)hint='放下起落架 G、打开襟翼 F。';
    else if(state.speed>86)hint='收油并按 B /「减速」至 220–300 km/h。';
    else if(state.speed<58)hint='推大油门，保持 220–300 km/h。';
    else if(state.y<20)hint='保持机翼水平，轻轻下滑接地。落地后收油并按住刹车。';
    else hint='轻压 W / ↑ 或前推摇杆下滑，保留约 40% 油门。';
  }else if(id==='stop'){title='接地滑跑';hint='收油至零，按住空格 /「刹车」停稳。';}
  else if(id==='done'){title=course.entry==='takeoff'?'三阶段教学完成':'分段练习完成';hint='飞机已在跑道上停稳。';}
  else if(target){
    const directions={city:'按 G 收轮，油门约 50%，从楼间穿过',pass:'提前抬头，瞄准双峰缺口',cloud:'抬头穿过前方云带',cruise:'爬升后松开俯仰，准备平飞',turn:'沿航标向海侧转弯',downwind:'沿东岸飞行，按 Ctrl 逐步收油',base:'收油并下降，减速至约 400 km/h',lineup:'向南端切入，减速至约 320 km/h',final:'按 G 放轮、F 开襟翼，减至 260 km/h'};
    hint=`${steer} · ${alt}。${directions[id]}。`;
  }
  return {stage,title,hint,phase:headings[stage],progress:sequence.indexOf(id)/(sequence.length-1),target,distance,bearing};
}

function cityMeshes(root) {
  const geometry=new THREE.BoxGeometry(1,1,1), transform=new THREE.Object3D();
  function batch(name,items,metalness,roughness) {
    const material=new THREE.MeshStandardMaterial({metalness,roughness});
    const mesh=new THREE.InstancedMesh(geometry,material,items.length);
    mesh.name=name;
    items.forEach((item,i)=>{
      transform.position.set(item.x,item.base+item.height/2,item.z);
      transform.scale.set(item.width,item.height,item.depth);
      transform.updateMatrix();
      mesh.setMatrixAt(i,transform.matrix);
      mesh.setColorAt(i,new THREE.Color(item.color));
    });
    mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
  }
  batch('港区码头',quays.map(q=>({...q,color:'#938e82'})),.14,.88);
  const concrete=['#acaaa0','#8d9ca2','#b5b4a9','#7b8b92'];
  batch('楼间航道',buildings.map((b,i)=>({...b,color:concrete[i%4]})),.24,.55);
  const glass=[],piers=[];
  buildings.forEach((b,i)=>{
    for(let y=9;y<b.height-5;y+=8)
      glass.push({...b,base:b.base+y,height:4.7,width:b.width+.4,depth:b.depth+.4,color:i%3===0?'#596e77':'#495e68'});
    for(const side of [-1,1])
      piers.push({...b,x:b.x+side*(b.width*.29),width:1.9,depth:b.depth+1,color:'#a8a9a3'});
  });
  batch('玻璃幕墙',glass,.52,.28);
  batch('竖向构件',piers,.32,.59);
}
function ridgeMeshes(root) {
  for(const r of ridges){
    const positions=[],colors=[],indices=[];
    for(let j=0;j<=r.nz;j++)for(let i=0;i<=r.nx;i++){
      const k=j*(r.nx+1)+i,h=r.heights[k], x=r.left+r.width*i/r.nx,z=r.near+r.length*j/r.nz;
      positions.push(x,h,z);
      const slope=Math.abs((r.heights[j*(r.nx+1)+Math.min(r.nx,i+1)]-h)/(r.width/r.nx));
      const grain=(Math.sin(i*42.17+j*36.11)+1)*.04;
      const rock=clamp((slope-.34)*.88+h/1250,0,1);
      const base=new THREE.Color(h<6?'#a69c83':'#6a735d').lerp(new THREE.Color('#8c8d87'),rock).multiplyScalar(.94+grain);
      colors.push(base.r,base.g,base.b);
      if(i<r.nx&&j<r.nz){const south=k+r.nx+1;indices.push(k,south,k+1,k+1,south,south+1);}
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geo.setIndex(indices);geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.96}));
    mesh.name='双峰岩脊';mesh.receiveShadow=true;mesh.castShadow=true;root.add(mesh);
  }
}
function cloudMesh() {
  const material=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,side:THREE.DoubleSide,
    uniforms:{lightTint:{value:new THREE.Color('#eceeed')},shadeTint:{value:new THREE.Color('#9aaab2')}},
    vertexShader:`
      varying vec2 vUv;
      varying float vSeed;
      void main(){
        vec4 centre=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
        centre.xy+=position.xy*vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));
        vSeed=fract(instanceMatrix[3].x*.01739);
        vUv=uv;
        gl_Position=projectionMatrix*centre;
      }`,
    fragmentShader:`
      uniform vec3 lightTint,shadeTint;
      varying vec2 vUv;
      varying float vSeed;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){
        vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);
      }
      void main(){
        vec2 p=2.*vUv-1.;
        vec2 uv=vUv*5.+vSeed*72.;
        float n=noise(uv)*.56+noise(uv*2.)*.28+noise(uv*4.)*.16;
        float density=1.-smoothstep(.28,.99,length(p)+(.53-n)*.62);
        if(density<.008)discard;
        gl_FragColor=vec4(mix(shadeTint,lightTint,clamp(vUv.y*.69+n*.54,0.,1.)),density*.57);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const transform=new THREE.Object3D(),cloud=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),material,27);
  for(let n=0;n<cloud.count;n++){
    const i=n%9,row=Math.floor(n/9),wave=Math.sin(n*83.14);
    transform.position.set(950+(i-4)*210+wave*72,548+Math.sin(i*.91+row)*42+row*22,-5630+(row-1)*240+wave*64);
    transform.scale.set(500+110*Math.cos(n*2.1),176+37*Math.sin(i*1.71),1);
    transform.updateMatrix();cloud.setMatrixAt(n,transform.matrix);
  }
  cloud.frustumCulled=false;cloud.name='海上云带';return cloud;
}
export function createFighterScenery(scene) {
  const root=new THREE.Group();root.name='青屿飞行学校';root.visible=false;scene.add(root);
  cityMeshes(root);ridgeMeshes(root);root.add(cloudMesh());
  const gate=new THREE.Mesh(new THREE.TorusGeometry(1,.009,5,80),new THREE.MeshBasicMaterial({color:0x82d8d6,transparent:true,opacity:.87,depthWrite:false}));
  gate.name='当前教学航标';root.add(gate);
  let displayed=null;
  function update(course){
    root.visible=!!course;
    const target=byId.get(course?.step);
    gate.visible=!!target&&target.id!=='land'&&!course?.failed&&!course?.complete;
    if(!gate.visible||displayed===target)return;
    displayed=target;
    gate.position.set(target.x,target.y,target.z);
    gate.rotation.y=-gateHeading(target);
    gate.scale.set(target.radius,target.halfHeight,Math.min(target.radius,target.halfHeight));
  }
  return {root,update};
}
