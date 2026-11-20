import { resetFlight, stepFlight } from './physics.js?v=5';

export const STAND = Object.freeze({ x: 225, z: 703, heading: Math.PI / 2 });
export const BRIDGE_BASE = Object.freeze({ x: 256, y: 12.12, z: 678 });
// Left forward door on the nose-in aircraft (the nose points east at the stand).
export const DOOR = Object.freeze({ x: 233, y: 12.12, z: 701.5 });
const TAKEOFF_BEACON = { x: 0, y: 140, z: -2550, name: '海岸离场点' };
const APPROACH = { x: 0, y: 45, z: -2210 };
// The right-hand circuit stays over the water, clear of both mountain islands.
const CIRCUIT = [
  {x:870,y:140,z:-3140,name:'海上东转点'}, {x:870,y:140,z:-4450,name:'北向航段'},
  {x:0,y:125,z:-4620,name:'五边切入点'}, {x:0,y:92,z:-3350,name:'跑道 18 进近'}
];
const LANDING = { x: 0, y: 11.8, z: -1000, name:'跑道 18 接地区' };
const GATE = { x: STAND.x, y: 11.8, z: STAND.z, name: 'C2 廊桥' };
const FLIGHT_PHASES = new Set(['takeoff','depart','return','approach','rollout']);
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
const point = (x, z) => ({x, z});

// Sample the actual curves by arc length, so motion through the tight gate and
// taxiway turns is continuous and independent of the geometry of each segment.
function makePath(start, segments) {
  const samples = [{ ...start, distance: 0 }];
  let previous = start;
  let distance = 0;
  for (const [a, b, end] of segments) {
    const origin = previous;
    for (let i = 1; i <= 28; i++) {
      const t = i / 28, u = 1 - t;
      const x = u**3 * origin.x + 3*u*u*t*a.x + 3*u*t*t*b.x + t**3*end.x;
      const z = u**3 * origin.z + 3*u*u*t*a.z + 3*u*t*t*b.z + t**3*end.z;
      distance += Math.hypot(x - previous.x, z - previous.z);
      previous = {x, z, distance}; samples.push(previous);
    }
  }
  return { samples, length: distance };
}
function samplePath(path, along) {
  const samples = path.samples;
  let hi = samples.length - 1, lo = 0;
  while (hi - lo > 1) {
    const middle = (hi + lo) >> 1;
    if (samples[middle].distance < along) lo = middle; else hi = middle;
  }
  const a = samples[lo], b = samples[hi];
  const t = clamp((along - a.distance) / Math.max(.0001, b.distance - a.distance), 0, 1);
  return { x: a.x + (b.x-a.x)*t, z: a.z+(b.z-a.z)*t, heading: Math.atan2(b.x-a.x,a.z-b.z) };
}
const pushPath = makePath(STAND, [[point(194,703),point(168,706),point(168,733)]]);
const outbound = makePath(point(168,733), [
  [point(168,704),point(139,707),point(139,665)],
  [point(139,550),point(139,485),point(139,434)],
  [point(139,410),point(128,400),point(104,400)],
  [point(82,400),point(70,400),point(45,400)],
  [point(15,400),point(0,389),point(0,357)]
]);
function inbound(state) {
  const start = point(state.x,state.z), sign = state.z > 400 ? -1 : 1;
  const segments = [];
  // A runway backtrack follows the centreline to the apron connector. Include
  // a curved turn pad when the aircraft has stopped facing away from that exit.
  const forwardZ = -Math.cos(state.heading);
  let beginZ = state.z;
  if (Math.sign(forwardZ) !== sign && Math.abs(beginZ-400)>50) {
    const bend = clamp(beginZ + forwardZ*17,-1783,1783);
    segments.push([point(state.x,bend),point(23,bend),point(23,beginZ)]);
    beginZ += sign*22;
    segments.push([point(23,beginZ),point(0,beginZ-sign*10),point(0,beginZ)]);
  }
  const turnZ = 400-sign*Math.min(30,Math.abs(400-beginZ)*.45);
  segments.push([point(0,beginZ), point(0,(beginZ+turnZ)/2),point(0,turnZ)]);
  segments.push([point(0,400),point(18,400),point(39,400)]);
  segments.push([point(80,400),point(90,400),point(105,400)]);
  segments.push([point(130,400),point(139,412),point(139,440)]);
  segments.push([point(139,520),point(139,615),point(139,653)]);
  segments.push([point(139,685),point(151,703),point(175,703)]);
  segments.push([point(194,703),point(209,703),STAND]);
  return makePath(start, segments);
}

export function createCivilOperation(state, entry='departure') {
  const approach = entry === 'approach', arrival = entry === 'arrival';
  resetFlight(state,{airborne:approach});
  Object.assign(state, {x:STAND.x, y:11.8, z:STAND.z, heading:STAND.heading, gear:true, flaps:false});
  if (arrival) Object.assign(state,{x:0,z:488,heading:0,hasFlown:true,landed:true});
  if (approach) Object.assign(state,{...APPROACH,heading:Math.PI,gear:true,flaps:true,speed:73,
    throttle:.43,pitch:-.015,verticalSpeed:-2.6,mach:73/343});
  return {phase:arrival?'rollout':approach?'approach':'gate', bridge:arrival||approach?0:1,
    path:null,along:0,parkingBrake:false,done:false,syncThrottle:null,entry,
    tugDeparture:arrival||approach?1:0,notice:'',noticeTime:0,passedBeacon:false,circuitLeg:0};
}
function changeGround(op, phase, path) { op.phase=phase; op.path=path; op.along=0; }
function idle(op,state) { op.syncThrottle=0;state.throttle=0;state.speed=0;state.mach=0; }
function say(op,message) { op.notice=message;op.noticeTime=4; }
export function civilAction(op,state) {
  if(!op || state.crashed || op.done) return false;
  switch (op.phase) {
    case 'gate':
      if(state.throttle>.08) { say(op,'先将油门收至 8% 以下，再联系地勤。'); return false; }
      op.phase='disconnect';idle(op,state);break;
    case 'hold': op.phase='takeoff';idle(op,state);break;
    case 'rollout':
      if(state.speed>.8 || state.throttle>.08) {say(op,'先收油并刹停，再申请滑回机位。');return false;}
      changeGround(op,'taxiIn',inbound(state));idle(op,state);break;
    case 'stand':
      if(!op.parkingBrake || state.throttle>.08 || state.speed>.3) {say(op,'收油至 8% 以下，按住刹车锁定停机位。');return false;}
      op.phase='connect'; break;
    default: return false;
  }
  op.notice='';op.noticeTime=0;return true;
}
function placeOnPath(op,state,travel,reverse=false) {
  const last = op.along;
  op.along = Math.min(op.path.length,op.along+travel);
  const next = samplePath(op.path,op.along);
  state.x=next.x;state.z=next.z;state.heading=next.heading+(reverse?Math.PI:0);
  state.distance+=op.along-last;
}
function advanceGround(op,state,controls,dt) {
  state.grounded=true;state.y=11.8;state.verticalSpeed=0;state.gForce=1;
  state.gear=true;state.boosting=false;state.pitch=0;state.roll=0;
  state.elapsed+=dt;state.throttle=clamp(controls.throttle??0,0,1);
  if(op.phase==='disconnect') {
    const activeTime=Math.min(dt,op.bridge*2.4);
    op.bridge=Math.max(0,op.bridge-activeTime/2.4);
    if(op.bridge<1e-6){op.bridge=0;changeGround(op,'pushback',pushPath);}
  } else if(op.phase==='pushback') {
    const braking=!!(controls.brake||controls.airbrake);
    const requested=braking?0:4.8;
    state.speed += clamp(requested-state.speed,-4*dt,2.1*dt);
    placeOnPath(op,state,state.speed*dt,true);
    if(op.along>=op.path.length){changeGround(op,'taxiOut',outbound);idle(op,state);}
  } else if(op.phase==='taxiOut'||op.phase==='taxiIn') {
    op.tugDeparture=Math.min(1,op.tugDeparture+dt*.16);
    const remaining=op.path.length-op.along;
    // Slow automatically on the final lead-in. The pilot still controls power
    // and sets the parking brake before the bridge can connect.
    const limit=op.phase==='taxiIn'&&remaining<32?3.2:13;
    const desired=controls.brake||controls.airbrake?0:Math.min(limit,state.throttle*22);
    state.speed+=clamp(desired-state.speed,-(controls.brake||controls.airbrake?7:3.4)*dt,3.1*dt);
    placeOnPath(op,state,state.speed*dt);
    if(op.along>=op.path.length) {
      const atStand=op.phase==='taxiIn';
      op.phase=atStand?'stand':'hold';state.speed=0;state.heading=atStand?STAND.heading:0;
      if(!atStand)idle(op,state);
    }
  } else if(op.phase==='stand') {
    if((controls.brake||controls.airbrake)&&state.throttle<=.08)op.parkingBrake=true;
    if(state.throttle>.08)op.parkingBrake=false;
  } else if(op.phase==='connect') {
    op.bridge=Math.min(1,op.bridge+dt/2.4);
    if(op.bridge>=1){op.phase='docked';op.done=true;}
  }
  state.mach=state.speed/343;
}
export function stepCivilOperation(op,state,controls,dt) {
  if(!op || op.done || state.crashed) return;
  dt=clamp(Number.isFinite(dt)?dt:0,0,.1);
  op.noticeTime=Math.max(0,op.noticeTime-dt);
  if(!FLIGHT_PHASES.has(op.phase)){advanceGround(op,state,controls,dt);return;}
  // Civil aircraft uses the shared flight and runway/touchdown checks. Limit
  // thrust and roll authority, and use the cabin aircraft's dry engines.
  const input={...controls,boost:false,throttle:Math.min(.83,controls.throttle??0),roll:(controls.roll||0)*.85};
  if(op.phase==='approach' && !state.grounded && input.assist!==false && state.speed<105 && state.y<180 && input.pitch<0) {
    const descent=state.y<24?2.0:3.8;
    const limit=-Math.asin(descent/(Math.max(state.speed,50)*.90))/.62;
    input.pitch=Math.max(input.pitch,limit);
  }
  stepFlight(state,input,dt);
  if(state.crashed)return;
  if(op.phase==='takeoff'&&!state.grounded)op.phase='depart';
  if(op.phase==='depart' && state.y>=75 && Math.hypot(state.x-TAKEOFF_BEACON.x,state.z-TAKEOFF_BEACON.z)<820){op.phase='return';op.passedBeacon=true;}
  if(op.phase==='return') {
    const fix=CIRCUIT[op.circuitLeg];
    if(op.circuitLeg<CIRCUIT.length-1 && Math.hypot(state.x-fix.x,state.z-fix.z)<250)op.circuitLeg++;
    if(op.circuitLeg>=2 && Math.abs(state.x)<350 && state.z<-2200 && Math.cos(state.heading)<-.80)op.phase='approach';
  }
  if(state.landed && state.grounded) {
    if(op.phase==='approach'){op.phase='rollout';say(op,'机轮接地。收油、刹停后联系地面滑行。');}
    else if(op.phase!=='rollout'){
      state.landed=false;op.phase='takeoff';op.circuitLeg=0;
      say(op,'航线尚未完成。重新加油起飞，依次跟随离场点和返航点。');
    }
  }
}
const remaining = op => Math.max(0,Math.ceil(op.path.length-op.along));
const kmh = state => Math.round(state.speed*3.6);
const BRIEFINGS = {
  gate:[1,'C2 机位 · 离港准备','油门归零，联系地勤。廊桥先撤离，牵引车随后推出。','撤桥并请求推出',GATE],
  disconnect:[1,'廊桥正在撤离','保持机轮静止，等待廊桥净空。'],
  pushback:[1,'牵引车推出',op=>`沿推出线后退，剩余 ${remaining(op)} 米。按住刹车可暂缓。`],
  taxiOut:[2,'滑行至起飞线',op=>`推油门至 35–60%，沿黄线辅助转向。距放行点 ${remaining(op)} 米。`],
  hold:[2,'进入跑道 · 等待放行','已对正跑道。确认起飞许可，再加大油门。','申请起飞许可'],
  takeoff:[3,'起飞滑跑',(op,state)=>`推满油门，达到 210 km/h 后轻按 S / 抬头。当前 ${kmh(state)} km/h。`,'',TAKEOFF_BEACON],
  depart:[3,'离场爬升','收轮，爬升至 250–500 FT，向北越过离场点。','',TAKEOFF_BEACON],
  return:[4,'海上返航','减速至约 300 km/h，沿导航点绕飞。转回航向 180°，从北侧对准跑道。'],
  approach:[4,'进近 · 平稳着陆','航向 180°，放轮 G、展襟翼 F。保持 245–275 km/h，压 W 缓降，临地展平。','',LANDING],
  rollout:[4,'着陆滑跑 · 刹停',(op,state)=>`油门归零，按住刹车（空格 / B）。当前 ${kmh(state)} km/h，停稳后联系地面。`,'申请滑回 C2',GATE],
  taxiIn:[5,'滑回 C2 机位',op=>`推油门沿黄线滑行。剩余 ${remaining(op)} 米，最后 32 米自动限速。`,'',GATE],
  stand:[5,'C2 停机线',op=>op.parkingBrake?'驻车制动已锁定。联系地勤，将廊桥对准左前舱门。':'收油至 8% 以下，按住刹车锁定驻车。','接靠廊桥',GATE],
  connect:[6,'廊桥接靠中','保持停稳，等待廊桥密封罩与左前舱门对接。','',GATE],
  docked:[6,'C2 停靠完成','驻车制动锁定，廊桥已与左前舱门对接。','',GATE]
};
export function civilBrief(op,state) {
  const [step,label,instruction,action='',fix=null]=BRIEFINGS[op.phase];
  const returning=op.phase==='return';
  const title=returning?`${label} · ${op.circuitLeg+1}/4`:label;
  const hint=op.noticeTime>0?op.notice:typeof instruction==='function'?instruction(op,state):instruction;
  const target=returning?CIRCUIT[op.circuitLeg]:fix;
  return {phase:op.phase,step,total:6,title,hint,target,action,done:op.done,progress:op.done?1:(step-1)/6};
}
