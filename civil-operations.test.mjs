import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from './dist/vendor/three.module.js';
import { createFlight } from './dist/physics.js';
import { createEnvironment } from './dist/environment.js';
import { STAND, DOOR, createCivilOperation, stepCivilOperation, civilAction, civilBrief } from './dist/civil-operations.js';
import { createCivilModel } from './dist/civil-model.js';

const dt=1/30;
const clamp=(x,a,b)=>Math.max(a,Math.min(x,b));
const wrapped=a=>Math.atan2(Math.sin(a),Math.cos(a));
function mockCanvas(create){
  const previous=globalThis.document;
  const ctx={fillRect(){},fillText(){},save(){},restore(){},translate(){},rotate(){},beginPath(){},scale(){},moveTo(){},lineTo(){},stroke(){},createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})};
  globalThis.document={createElement:()=>({getContext:()=>ctx})};
  try{return create();}finally{if(previous)globalThis.document=previous;else delete globalThis.document;}
}
const environment=mockCanvas(()=>createEnvironment(new THREE.Scene()));

function flight(entry){
  const s=createFlight(),op=createCivilOperation(s,entry);
  function simulate(until,input={},limit=300){
    for(let t=0;t<limit&&!until();t+=dt){
      stepCivilOperation(op,s,typeof input==='function'?input():input,dt);
      assert.equal(s.crashed,false,s.crashReason+' at '+JSON.stringify({x:s.x,y:s.y,z:s.z,phase:op.phase}));
      if(!s.grounded){
        const terrain=environment.heightAt(s.x,s.z);
        assert.ok(terrain<=10 || s.y>=terrain+1.8,'terrain on '+op.phase);
      }
    }
    assert.ok(until(),'timed out on '+JSON.stringify({phase:op.phase,leg:op.circuitLeg,x:s.x,y:s.y,z:s.z,heading:s.heading,speed:s.speed}));
  }
  return {s,op,simulate};
}

function fly(f){
  const {s,op}=f;
  const cue=civilBrief(op,s);
  if(op.phase==='takeoff')return {throttle:1,pitch:s.speed>=58?1:0,gear:true};
  const final=op.phase==='approach';
  const target=cue.target;
  const heading=final?Math.atan2(-s.x,-280):Math.atan2(target.x-s.x,s.z-target.z);
  const err=wrapped(heading-s.heading);
  const roll=clamp(err*2,-1,1), yaw=clamp(err*1.6,-1,1);
  const targetHeight=final?9.7+Math.max(0,-1500-s.z)*.043:target.y;
  const climb=clamp((targetHeight-s.y)*.35,-6,26)+(1-Math.cos(s.roll))*2.2;
  const pitch=clamp(Math.asin(clamp(climb/(Math.max(s.speed,50)*.9),-.95,.95))/.62,-1,1);
  const speed=final?72:84;
  const drag=.5+.00035*s.speed*s.speed+9.81*Math.sin(s.pitch-.035)+(final?1.7+s.speed*.014+s.speed*s.speed*.0001:0);
  const throttle=clamp((Math.max(.15,drag)/32)**(1/2.2)+(speed-s.speed)*.022,0,1);
  return {gear:final,flaps:final,pitch:final&&targetHeight<s.y?Math.min(pitch,-.041):pitch,roll,yaw,throttle,assist:true,boost:true};
}

function taxiHome(f){
  const {s,op,simulate}=f;
  simulate(()=>s.speed===0,{brake:true,throttle:0},25);
  assert.ok(civilAction(op,s));
  simulate(()=>op.phase==='stand',{throttle:.55});
  assert.equal(s.x,STAND.x);assert.equal(s.z,STAND.z);assert.equal(s.heading,STAND.heading);
  assert.equal(civilAction(op,s),false);
  stepCivilOperation(op,s,{throttle:0,brake:true},dt);
  assert.equal(op.parkingBrake,true);assert.ok(civilAction(op,s));
  simulate(()=>op.done,{},4);
  assert.equal(op.bridge,1);assert.equal(civilBrief(op,s).progress,1);
}

test('complete turn from docked departure through takeoff, a terrain-clear circuit, real touchdown and return docking',()=>{
  const f=flight('departure'),{s,op,simulate}=f;
  assert.equal(op.bridge,1);assert.equal(s.heading,Math.PI/2);
  stepCivilOperation(op,s,{throttle:.4},dt);assert.equal(civilAction(op,s),false);
  stepCivilOperation(op,s,{throttle:0},dt);assert.ok(civilAction(op,s));
  simulate(()=>op.bridge<.48,{},2);
  assert.equal(s.x,STAND.x);assert.equal(s.z,STAND.z);
  simulate(()=>op.phase==='pushback',{},2);
  simulate(()=>op.along>5,{},8);const before=s.x;
  simulate(()=>s.speed===0,{brake:true},3);
  const pausedX=s.x;for(let i=0;i<15;i++)stepCivilOperation(op,s,{brake:true},dt);
  assert.equal(s.x,pausedX);assert.ok(s.x<before);
  simulate(()=>op.phase==='taxiOut',{},30);
  assert.equal(op.bridge,0);assert.equal(op.syncThrottle,0);
  simulate(()=>op.phase==='hold',{throttle:.62},100);
  assert.ok(civilAction(op,s));
  simulate(()=>op.phase==='depart',()=>fly(f),18);assert.equal(s.grounded,false);
  simulate(()=>op.phase==='return',()=>fly(f),100);assert.equal(op.passedBeacon,true);
  simulate(()=>op.phase==='approach',()=>fly(f),140);
  assert.equal(s.boosting,false);assert.ok(op.circuitLeg>=2);
  simulate(()=>op.phase==='rollout',()=>fly(f),110);
  assert.equal(s.landed,true);assert.ok(s.landingRate>-5);
  assert.equal(civilAction(op,s),false);
  taxiHome(f);
  assert.ok(s.distance>8000);
});

test('continuous keyboard nose-down on short final can settle on the wheels with assistance',()=>{
  const f=flight('approach'),{s,op,simulate}=f;
  simulate(()=>op.phase==='rollout',{pitch:-1,throttle:.46,gear:true,flaps:true,assist:true},35);
  assert.ok(s.landingRate<0 && s.landingRate>-3);
  taxiHome(f);
});

test('arrival from rollout, ground service interlocks, and a fresh gate departure',()=>{
  const f=flight('arrival');taxiHome(f);
  const {s}=f,restart=createCivilOperation(s,'departure');
  assert.equal(restart.phase,'gate');assert.equal(restart.done,false);assert.equal(restart.tugDeparture,0);
  assert.equal(s.landed,false);assert.equal(restart.bridge,1);assert.equal(s.speed,0);
});

test('simulated early touchdown cannot finish a full flight',()=>{
  const {s,op}=flight('departure');
  Object.assign(s,{x:0,z:560,hasFlown:true,landed:true,grounded:true});
  op.phase='depart';
  stepCivilOperation(op,s,{throttle:0},dt);
  assert.equal(op.phase,'takeoff');assert.equal(op.done,false);assert.equal(civilAction(op,s),false);
});

test('airliner stance, door seal and boarding bridge movement agree with the ground service state',()=>{
  const scene=new THREE.Scene(),model=mockCanvas(()=>createCivilModel(scene));
  const {s,op}=flight('departure');
  model.setVisible(true);model.update(s,0);model.updateGround(op);scene.updateMatrixWorld(true);
  const portDoor=model.root.localToWorld(new THREE.Vector3(-1.5,.32,-8));
  assert.ok(portDoor.distanceTo(new THREE.Vector3(DOOR.x,DOOR.y,DOOR.z))<.001);
  const bodyBounds=new THREE.Box3().setFromObject(model.root,true);
  assert.ok(Math.abs(bodyBounds.min.y-(s.y-2.7))<.01);
  const terminal=scene.getObjectByName('Qingyu passenger gate C2');
  const bridgeCab=terminal.getObjectByName('Passenger bridge cab');
  assert.ok(bridgeCab.getWorldPosition(new THREE.Vector3()).distanceTo(portDoor)<.001);
  op.bridge=0;model.updateGround(op);scene.updateMatrixWorld(true);
  assert.ok(bridgeCab.getWorldPosition(new THREE.Vector3()).distanceTo(portDoor)>20);
  model.setVisible(false);assert.equal(terminal.visible,false);assert.equal(model.root.visible,false);
});
