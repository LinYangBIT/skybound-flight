import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from './dist/vendor/three.module.js';
import { createEnvironment } from './dist/environment.js';
import { runwayAt } from './dist/airfield.js';
import { stepFlight } from './dist/physics.js';
import { createFighterCourse, fighterSpawn, stepFighterCourse, fighterGuidance, fighterLessonInput, createFighterScenery, FIGHTER_ROUTE } from './dist/fighter-course.js';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const wrap=n=>Math.atan2(Math.sin(n),Math.cos(n));

// Exercise a full sortie against the same island meshes and aircraft integrator
// used by the game. Canvas drawing is irrelevant for the height samples.
function environment() {
  const original=globalThis.document;
  const context={fillRect(){},fillText(){},save(){},scale(){},translate(){},rotate(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})};
  globalThis.document={createElement:()=>({getContext:()=>context})};
  try{return createEnvironment(new THREE.Scene());}
  finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
}
const env=environment();

function flyToCue(course,s) {
  if(course.step==='stop')return {throttle:0,brake:true,gear:true,flaps:true};
  if(course.step==='takeoff')return {throttle:1,pitch:s.speed>59?1:0,gear:true};
  const cue=fighterGuidance(course,s),id=course.step;
  const approach=['base','lineup','final','land'].includes(id);
  const slow=id==='base'?110:id==='lineup'?90:72;
  const wantedSpeed=approach?slow:145, gear=id==='final'||id==='land';
  const target=cue.target;
  let altitude=target?.y??850,heading=target?Math.atan2(target.x-s.x,s.z-target.z):s.heading;
  if(id==='land'){
    altitude=9.8+clamp((s.z-1150)*.040,0,100);
    heading=Math.atan2(-s.x,360);
  }
  const turnError=wrap(heading-s.heading);
  const roll=clamp(Math.atan(turnError*s.speed/(9.81*1.6))/1.2,-1,1);
  const yaw=clamp(turnError,-1,1);
  const wantedClimb=clamp((altitude-s.y)*.48,-22,50);
  const bankSink=(1-Math.cos(s.roll))*2.2;
  let pitch=clamp(Math.asin(clamp((wantedClimb+bankSink)/(Math.max(s.speed,55)*.9),-.9,.9))/.62,-1,1);
  // Digital elevator inputs have a dead zone. Short final needs a positive
  // downward command through the last metres to settle on the wheels.
  if(id==='land'&&altitude<s.y&&pitch>-.033)pitch=-.033;
  const drag=.5+.00035*s.speed*s.speed+9.81*Math.sin(s.pitch-.035)+(gear?1.7+s.speed*.014+s.speed*s.speed*.0001:0);
  const throttle=clamp((Math.max(.1,drag)/32)**(1/2.2)+(wantedSpeed-s.speed)*.02,0,1);
  return {pitch,roll,yaw,throttle,gear,flaps:gear,airbrake:s.speed>wantedSpeed+5,assist:true};
}
function flyLesson(entry,commands=flyToCue) {
  const s=fighterSpawn(entry),course=createFighterCourse(entry),steps=[course.step];
  const dt=1/30;
  for(let i=0;i<60*12/dt&&!course.complete&&!course.failed;i++){
    const a={x:s.x,y:s.y,z:s.z},controls=fighterLessonInput(course,s,commands(course,s));
    stepFlight(s,controls,dt);
    const ground=env.heightAt(s.x,s.z);
    assert.ok(s.grounded||ground<10||s.y>=ground+1.8,`terrain at ${s.x.toFixed(0)},${s.z.toFixed(0)} during ${course.step}; ${s.y.toFixed(0)} < ${ground.toFixed(0)}`);
    stepFighterCourse(course,a,s,dt);
    if(steps.at(-1)!==course.step)steps.push(course.step);
  }
  assert.equal(course.failed,false,`${course.step}: ${course.reason} @ ${s.x},${s.y},${s.z}`);
  assert.equal(course.complete,true,`stuck at ${course.step}, @ ${s.x},${s.y},${s.z}`);
  assert.ok(s.landingRate<0&&s.landingRate>-5);
  assert.ok(s.landed&&s.grounded&&s.speed<=1&&runwayAt(s.x,s.z));
  return steps;
}
test('a continuous fighter sortie clears the route in order and stops on the runway',()=>{
  assert.deepEqual(flyLesson('takeoff'),['takeoff','city','pass','cloud','cruise','level','turn','downwind','base','lineup','final','land','stop','done']);
});
test('landing practice starts airborne and finishes with a controlled touchdown and braking',()=>{
  assert.deepEqual(flyLesson('landing'),['land','stop','done']);
  // The literal controls displayed by the instructor also suffice on keyboard:
  // hold W on final, then close the throttle and hold the wheel brake.
  const keyboard=course=>course.step==='stop'
    ? {throttle:0,brake:true,gear:true,flaps:true}
    : {pitch:-1,throttle:.43,gear:true,flaps:true};
  assert.deepEqual(flyLesson('landing',keyboard),['land','stop','done']);
});
test('flight practice joins the same corridor and can finish the lesson',()=>{
  assert.deepEqual(flyLesson('flight'),['city','pass','cloud','cruise','level','turn','downwind','base','lineup','final','land','stop','done']);
});
test('swept tower and ridge impacts fail the flight while generous misses cannot score gates',()=>{
  const swept=createFighterCourse('flight'),a={...fighterSpawn('flight'),x:0,y:60,z:-2695};
  stepFighterCourse(swept,a,{...a,x:620},1/60);
  assert.match(swept.reason,/建筑/);
  const ridge=createFighterCourse('flight'),b={...a,x:1370,y:70,z:-4320};
  stepFighterCourse(ridge,b,{...b,z:-4370},1/60);
  assert.match(ridge.reason,/山坡/);
  const miss=createFighterCourse('flight'),c={...a,x:430,y:410,z:-2320};
  stepFighterCourse(miss,c,{...c,z:-2610},1/60);
  assert.equal(miss.step,'city');
  const g=FIGHTER_ROUTE[0],start={...a,x:g.x,y:g.y,z:g.z+140},near={...a,x:g.x,y:g.y,z:g.z+4};
  stepFighterCourse(miss,start,near,1/30);
  assert.equal(miss.step,'city','getting near a tower corridor does not count as crossing it');
  stepFighterCourse(miss,near,{...near,z:g.z-4},1/30);
  assert.equal(miss.step,'pass');
});
test('unstable cruise cancels the continuous hold, a missed approach rejoins the circuit',()=>{
  const course=createFighterCourse('flight');course.step='level';
  const s={...fighterSpawn('flight'),y:850};
  for(let i=0;i<26;i++)stepFighterCourse(course,s,s,.1);
  stepFighterCourse(course,s,{...s,roll:.6},.1);
  assert.equal(course.hold,0);
  for(let i=0;i<31;i++)stepFighterCourse(course,s,s,.1);
  assert.equal(course.step,'turn');
  const approach=createFighterCourse('landing'),high={...fighterSpawn('landing'),z:-1600};
  stepFighterCourse(approach,high,high,.05);
  assert.equal(approach.step,'downwind');
  stepFighterCourse(approach,high,{...high,z:19800},.05);
  assert.ok(approach.failed);
});
test('ground contact alone cannot complete the lesson and helpers leave other controls untouched',()=>{
  const course=createFighterCourse('flight');
  const s={...fighterSpawn('landing'),grounded:true,landed:true};
  stepFighterCourse(course,s,s,.05);
  assert.ok(course.failed&&!course.complete);
  const approach=createFighterCourse('landing'),air=fighterSpawn('landing');
  assert.ok(fighterLessonInput(approach,air,{pitch:-1,throttle:.4}).pitch>-.2);
  const raw={pitch:-1,assist:false};
  assert.equal(fighterLessonInput(approach,air,raw),raw);
});
test('school scenery displays the active landmark and clears the marker on final',()=>{
  const scene=new THREE.Scene(),scenery=createFighterScenery(scene);
  assert.equal(scenery.root.visible,false);
  const course=createFighterCourse('flight');scenery.update(course);
  const marker=scene.getObjectByName('当前教学航标');
  assert.ok(marker.visible&&scenery.root.visible);
  assert.equal(marker.position.z,FIGHTER_ROUTE[0].z);
  scenery.update(createFighterCourse('landing'));assert.equal(marker.visible,false);
  scenery.update(null);assert.equal(scenery.root.visible,false);
});
