import * as THREE from './vendor/three.module.js';
import { createFlight, resetFlight, stepFlight } from './physics.js?v=4';
import { createEnvironment } from './environment.js?v=4';
import { createAircraft } from './aircraft.js?v=4';
import { createCameraEffects } from './camera-effects.js?v=4';
import { createFlightAudio } from './audio.js?v=4';
import { createFrameMetrics } from './frame-metrics.js?v=4';
import { createChallenge, stepChallenge, challengeRank, CHALLENGE_SECONDS } from './challenge.js?v=4';

const $ = id => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const show = (id, visible = true) => $(id).classList.toggle('hidden', !visible);
const fmtTime = seconds => `${String(Math.floor((seconds + 1e-6) / 60)).padStart(2, '0')}:${String(Math.floor((seconds + 1e-6) % 60)).padStart(2, '0')}`;
const state = createFlight({airborne: true});
const controls = { pitch: 0, roll: 0, yaw: 0, throttle: state.throttle, brake: false, gear: false, flaps: false, assist: true, boost: false, airbrake: false };
const keys = new Set();
let mode = 'challenge', weather = 'clear', playing = false, paused = false, finished = false, started = false;
let cameraMode = 0, waypoint = 0, hasTakeoffToast = false, ready = false, helpWasPaused = false;
let toastExpiry = 0, clockTime = 0, lastFrame = 0, uiTime = 0;
const storedScore = value => {const n=Number(value);return Number.isFinite(n)&&n>=0?n:0;};
let best = 0, challengeBest = 0;
let run = createChallenge(), audioWasPaused = false, supersonic = false;
let quality = 'auto', qualityReduced = false, slowFrames = 0;
try { challengeBest = storedScore(localStorage.getItem('skybound-challenge-best')); const q = localStorage.getItem('skybound-quality'); if (['auto','high','low'].includes(q)) quality = q; } catch {}
const audio = createFlightAudio();
const touchDevice = matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0;
let touchOverride = null;
try {const saved=localStorage.getItem('skybound-touch');if(saved==='on'||saved==='off')touchOverride=saved==='on';}catch{}
function syncTouch(){const enabled=touchOverride??touchDevice;$('app').classList.toggle('touch-device',enabled);$('app').classList.toggle('touch-off',touchOverride===false);$('touchToggle').checked=enabled;}
syncTouch();
try { best = storedScore(localStorage.getItem('skybound-best')); } catch {}
const touch = { roll: 0, pitch: 0, up: false, brake: false, airbrake: false };
const route = [
  { x: 0, y: 165, z: -1500, name: '离场航点' },
  { x: 1450, y: 280, z: -2500, name: '海湾转向' },
  { x: 2350, y: 370, z: -350, name: '云端巡航' },
  { x: 1700, y: 270, z: 1550, name: '沿岸返航' },
  { x: 0, y: 155, z: 2250, name: '最后进近' },
];
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, .15, 60000);
let renderer, env, aircraft, cameraEffects, frameMetrics;
let lowPassScore = 0, lowPassTime = 0, peakSpeed = 0, renderFov = 64;
const rings = [];
const chasePosition = new THREE.Vector3();
const targetPosition = new THREE.Vector3();
const aim = new THREE.Vector3();
const previousPosition = new THREE.Vector3();
const mapCtx = $('map').getContext('2d');
const attitudeCtx = $('attitude').getContext('2d');
const cameraLabels = ['追尾视角', '驾驶舱视角', '全景视角'];
const forward = new THREE.Vector3(), side = new THREE.Vector3(), pilotPosition = new THREE.Vector3();
const currentPosition = new THREE.Vector3(), segment = new THREE.Vector3(), routeCenter = new THREE.Vector3(), closest = new THREE.Vector3();

function toast(message, duration = 5000) {
  $('toast').textContent = message;
  show('toast');
  toastExpiry = performance.now() + duration;
}
function initialize() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $('world'), antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, touchDevice ? 1 : 1.5));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !touchDevice && innerWidth > 760;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    env = createEnvironment(scene, renderer);
    aircraft = createAircraft(scene);
    cameraEffects = createCameraEffects(renderer);
    frameMetrics = createFrameMetrics($('world'),renderer);
    applyQuality();
    route.forEach((p, index) => {
      const ring = new THREE.Group();
      const torus = new THREE.Mesh(new THREE.TorusGeometry(160, 1.6, 6, 80), new THREE.MeshBasicMaterial({color: 0xccebdc, transparent: true, opacity: .85}));
      const outer = new THREE.Mesh(new THREE.TorusGeometry(169, .45, 4, 80), new THREE.MeshBasicMaterial({color: 0xe0e9e5, transparent: true, opacity: .3}));
      ring.add(torus, outer);
      ring.position.set(p.x, p.y, p.z);
      const prev = index ? route[index - 1] : {x: 0, y: 20, z: 650};
      ring.lookAt(prev.x, p.y, prev.z);
      scene.add(ring); rings.push(ring);
    });
    camera.position.set(state.x+30, state.y+9, state.z+35);
    camera.lookAt(state.x, state.y, state.z-25);
    updateRingVisibility();
    ready = true;
    $('startBtn').disabled = false;
    $('startBtn').firstElementChild.textContent = '立即出发';
    $('throttleSlider').value = Math.round(controls.throttle * 100);
    updateSwitches();
    show('loading', false);
    renderInstruments();
    requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    $('loadingText').textContent = '三维场景未能加载，请使用支持 WebGL 的浏览器重新打开。';
    document.querySelector('.loader').style.display = 'none';
  }
}

function updateRingVisibility() {
  rings.forEach((ring, i) => {
    ring.visible = started && mode === 'training' && i >= waypoint;
    ring.children[0].material.opacity = i === waypoint ? .85 : .17;
    ring.children[1].visible = i === waypoint;
  });
}
function begin() {
  if (!ready) return;
  resetFlight(state, { airborne: mode !== 'training' });
  run = createChallenge(); supersonic = false; lastFrame = performance.now();
  Object.assign(controls, {pitch: 0, roll: 0, yaw: 0, throttle: state.throttle, brake: false, gear: mode === 'training', flaps: false, boost: false, airbrake: false});
  state.gear = controls.gear;
  keys.clear(); touch.roll = touch.pitch = 0; touch.up = touch.brake = touch.airbrake = false;
  playing = started = true; paused = finished = false; waypoint = 0; hasTakeoffToast = mode !== 'training'; lowPassScore = lowPassTime = 0; peakSpeed = state.speed;
  cameraMode = 0;
  aircraft.setCockpit(false);
  $('app').classList.add('in-flight'); $('app').classList.remove('cockpit-mode');
  $('cameraName').textContent = cameraLabels[0];
  for (const id of ['welcome', 'pauseOverlay', 'resultOverlay', 'helpOverlay', 'audioOverlay']) show(id, false);
  for (const id of ['missionPanel', 'reticle', 'touchControls', 'speedTelemetry']) show(id);
  $('missionTitle').textContent = {training:'起降挑战',free:'自由掠海',challenge:'90 秒低空挑战'}[mode];
  show('challengeHud', mode !== 'training');
  $('endFlightBtn').classList.toggle('hidden', mode !== 'free');
  $('pauseBtn').disabled = false;
  $('pauseBtn').innerHTML = '<span>Ⅱ</span> 暂停';
  $('throttleSlider').value = Math.round(controls.throttle * 100);
  updateSwitches(); updateRingVisibility();
  camera.position.set(state.x + 0, state.y + 7, state.z + 32);
  toast(mode === 'training' ? 'Shift 加大油门，达到 210 km/h 后按 S 抬头。' : '已以 864 km/h 入场 · 按住空格加力，B 空气刹车，C 驾驶舱。', 7000);
  updateAudio(); audio.unlock().then(ok=>{if(ok&&playing&&!paused&&!finished)audio.cue('start');});
}
function pause(value = !paused) {
  if (!playing || finished) return;
  paused = value; resetInputs(); lastFrame = performance.now();
  touch.roll = touch.pitch = 0; touch.up = touch.brake = touch.airbrake = false;
  $('joystickKnob').style.transform = ''; controls.boost=controls.airbrake=false;
  show('pauseOverlay', paused);
  $('pauseBtn').innerHTML = paused ? '<span>▶</span> 继续' : '<span>Ⅱ</span> 暂停';
  updateAudio();
}
function home() {
  playing = started = paused = finished = false;
  resetFlight(state, {airborne:true}); controls.throttle = state.throttle; controls.gear = false; controls.flaps = false; controls.boost = controls.airbrake = false;
  cameraMode = 0; aircraft.setCockpit(false); keys.clear();
  $('app').classList.remove('in-flight', 'cockpit-mode');
  for (const id of ['missionPanel','resultOverlay','pauseOverlay','touchControls','reticle','ringLabel','warning','speedTelemetry','challengeHud','gateCue','audioOverlay','helpOverlay']) show(id, false);
  show('welcome'); $('pauseBtn').disabled = true; $('cameraName').textContent = cameraLabels[0];
  $('throttleSlider').value = Math.round(controls.throttle*100); resetInputs(); updateSwitches(); updateRingVisibility(); updateAudio();
}
function finish(success, reason = 'landing') {
  if (finished) return;
  finished = true; paused = false; resetInputs();
  show('pauseOverlay', false); show('warning', false); show('ringLabel', false); show('gateCue', false);
  const completed = mode === 'free' || waypoint === route.length;
  const score = Math.floor(lowPassScore) + (mode !== 'challenge' && reason === 'landing' && success ? Math.max(100, Math.round(1000 - Math.abs(state.landingRate) * 110 + waypoint * 150)) : waypoint * 150);
  if (score > best) { best = score; try { localStorage.setItem('skybound-best', String(best)); } catch {} }
  $('resultEyebrow').textContent = success ? 'WELCOME HOME, PILOT' : 'FLIGHT REPORT';
  $('resultTitle').textContent = success ? (completed ? '漂亮的着陆。' : '已安全返回机场。') : '再试一次，飞行员。';
  $('resultText').textContent = success ? (completed ? '你已完成这段旅程。海风会记得你的航迹。' : '着陆成功！下次试着穿过全部 5 个航点，完成海岸巡航。') : `${state.crashReason || '飞机接触了地面'}。本次极速 ${Math.round(peakSpeed * 3.6)} km/h。低空时提前拉起，进近时按 B 减速。`;
  $('resultStats').innerHTML = `<div><strong>${fmtTime(state.elapsed)}</strong><small>飞行时间</small></div><div><strong>${(state.distance / 1000).toFixed(1)}</strong><small>飞行里程 KM</small></div><div><strong>${score}</strong><small>本次得分 · 最高 ${best}</small></div>`;
  show('resultOverlay'); $('pauseBtn').disabled = true;
  if (mode === 'challenge') {
    if (score > challengeBest) { challengeBest = score; try { localStorage.setItem('skybound-challenge-best', String(score)); } catch {} }
    $('resultEyebrow').textContent = reason === 'time' ? 'SORTIE COMPLETE' : 'CHALLENGE REPORT';
    $('resultTitle').textContent = reason === 'time' ? `${challengeRank(score)}。` : success ? '提前返航。' : '下次再挑战。';
    $('resultText').textContent = `${reason === 'time' ? '90 秒挑战完成' : state.crashReason || '提前着陆，低空得分已记录'} · 低空 ${Math.floor(run.lowTime)} 秒 · 最高 ×${run.bestMultiplier} 倍率 · 极速 ${Math.round(peakSpeed * 3.6)} km/h。`;
    $('resultStats').lastElementChild.innerHTML = `<strong>${score}</strong><small>挑战得分 · 纪录 ${challengeBest}</small>`;
  } else if (reason === 'bank') {
    $('resultTitle').textContent = '本次飞行已记录。';
    $('resultText').textContent = `低空 ${Math.floor(run.lowTime)} 秒 · 最高 ×${run.bestMultiplier} 倍率 · 极速 ${Math.round(peakSpeed * 3.6)} km/h。`;
  }
  updateAudio(); audio.cue(success ? 'complete' : 'crash');
}
function updateSwitches() {
  $('gearBtn').classList.toggle('selected', controls.gear);
  $('flapsBtn').classList.toggle('selected', controls.flaps);
  $('assistBtn').classList.toggle('active', controls.assist);
  $('assistState').textContent = controls.assist ? 'ON' : 'OFF';
  $('gearBtn').setAttribute('aria-pressed', String(controls.gear));
  $('flapsBtn').setAttribute('aria-pressed', String(controls.flaps));
  $('assistBtn').setAttribute('aria-pressed', String(controls.assist));
}
function toggleGear() {
  if (state.grounded && controls.gear) { toast('请在离地后收起起落架。', 2500); return; }
  controls.gear = !controls.gear; updateSwitches(); toast(controls.gear ? '起落架已放下 · 准备着陆' : '起落架已收起', 2200);
}
function switchCamera() {
  cameraMode = (cameraMode + 1) % 3;
  $('cameraName').textContent = cameraLabels[cameraMode];
  $('app').classList.toggle('cockpit-mode', cameraMode === 1);
  aircraft?.setCockpit(cameraMode === 1);
  toast(cameraLabels[cameraMode], 1500);
}
function openHelp() {
  helpWasPaused = paused;
  if (playing && !finished) paused = true;
  resetInputs(); show('helpOverlay'); updateAudio();
}
function closeHelp() { show('helpOverlay', false); if(playing&&!finished)pause(helpWasPaused); else updateAudio(); }
function resetInputs() {
  keys.clear(); touch.roll = touch.pitch = 0; touch.up = touch.brake = touch.airbrake = false;
  controls.boost = controls.airbrake = controls.brake = false;
  $('joystickKnob').style.transform = '';
}
function syncAudioControls() {
  const p = audio.preferences;
  $('musicToggle').checked = p.musicEnabled; $('sfxToggle').checked = p.sfxEnabled;
  $('musicVolume').value = Math.round(p.musicVolume * 100); $('sfxVolume').value = Math.round(p.sfxVolume * 100);
  $('soundBtn').classList.toggle('sound-on', p.musicEnabled || p.sfxEnabled);
  $('soundBtn').setAttribute('aria-label', '声音与画质设置');
}
function updateAudio() {
  audio.update({playing, paused, finished, hidden:document.hidden, speed:state.speed, throttle:controls.throttle, boosting:state.boosting, lowPass:run.active, intensity:Math.min(1,(run.multiplier-1)/3)});
  const d = audio.diagnostics();
  $('audioStatus').textContent = d.contextState === 'running' ? (d.musicActive ? '配乐播放中' : '音乐已暂停或关闭') : '操作游戏后自动播放';
  // Non-secret diagnostic output for lifecycle QA, not a gameplay control.
  $('audioStatus').dataset.context = d.contextState;
  $('audioStatus').dataset.scheduler = String(d.schedulerCount);
  $('audioStatus').dataset.voices = String(d.musicVoices);
  $('audioStatus').dataset.rms = String(d.outputRms);
}
function applyQuality() {
  if (!renderer) return;
  const low = quality === 'low' || (quality === 'auto' && (touchDevice || qualityReduced));
  const ratio = low ? (touchDevice ? .85 : 1) : 1.5;
  renderer.setPixelRatio(Math.min(devicePixelRatio, ratio)); renderer.setSize(innerWidth, innerHeight);
  if(renderer.shadowMap.enabled!==!low){
    renderer.shadowMap.enabled=!low;
    // Recompile receivers when switching shadow defines; otherwise low quality
    // may keep sampling the last frozen shadow map while its render pass stops.
    scene.traverse(object=>{for(const mat of (Array.isArray(object.material)?object.material:[object.material]))if(mat)mat.needsUpdate=true;});
  }
  cameraEffects?.setQuality(low ? 'low' : 'high'); cameraEffects?.resize(innerWidth, innerHeight);
  $('qualitySelect').value = quality;
  $('qualityStatus').textContent = quality === 'auto' ? `自动 · ${low ? '流畅优先' : '精细画面'}` : low ? '流畅 · 降低渲染开销' : '精细 · 完整光影';
}

function flightStep(dt) {
  controls.roll = clamp((keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + touch.roll, -1, 1);
  controls.pitch = clamp((keys.has('KeyS') || keys.has('ArrowDown') || touch.up ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) + touch.pitch, -1, 1);
  controls.yaw = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
  if (state.grounded) controls.yaw = clamp(controls.yaw + controls.roll, -1, 1);
  const throttleDirection = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0) - (keys.has('ControlLeft') || keys.has('ControlRight') ? 1 : 0);
  if (throttleDirection) { controls.throttle = clamp(controls.throttle + throttleDirection * dt * .65, 0, 1); $('throttleSlider').value = Math.round(controls.throttle * 100); }
  controls.brake = state.grounded && (keys.has('Space') || touch.brake || keys.has('KeyB'));
  controls.boost = !state.grounded && (keys.has('Space') || touch.brake);
  controls.airbrake = !state.grounded && (keys.has('KeyB') || touch.airbrake);
  previousPosition.set(state.x, state.y, state.z);
  stepFlight(state, controls, dt);
  // Sweep the travelled segment so a fast jet cannot tunnel through a ridge.
  if (!state.grounded && !state.crashed) {
    const travelled = previousPosition.distanceTo(currentPosition.set(state.x,state.y,state.z));
    const samples = Math.max(1, Math.ceil(travelled / 8));
    for (let i=1; i<=samples; i++) {
      const t=i/samples, x=THREE.MathUtils.lerp(previousPosition.x,state.x,t), y=THREE.MathUtils.lerp(previousPosition.y,state.y,t), z=THREE.MathUtils.lerp(previousPosition.z,state.z,t);
      const terrain = env.heightAt(x,z);
      if(y<terrain+1.8 && terrain>10){state.crashed=true;state.crashReason='高速接近地形，未能及时拉起';break;}
    }
  }
  const agl=state.y-env.heightAt(state.x,state.z)-2.8;
  peakSpeed=Math.max(peakSpeed,state.speed);
  const previousMultiplier = run.multiplier;
  if (mode !== 'training') { stepChallenge(run,{speed:state.speed,agl,grounded:state.grounded,crashed:state.crashed},dt,mode==='challenge'); lowPassScore=run.score; lowPassTime=run.lowTime; }
  if(run.multiplier>previousMultiplier){audio.cue('checkpoint');toast(`连续低空 ×${run.multiplier} · 保持航线，得分快${run.multiplier}倍`,2200);}
  if(!supersonic && state.mach>=1){supersonic=true;audio.cue('sonic');toast('MACH 1 · 已突破音速',2000);}
  if(state.mach<.95)supersonic=false;
  if (!state.grounded && !hasTakeoffToast) {
    hasTakeoffToast = true;
    toast(mode === 'training' ? '离地成功！朝导航航点飞行，按 G 收起起落架。' : '按住空格加力突破音速，按 B 空气刹车。', 5000);
  }
  if (mode === 'training' && waypoint < route.length) {
    const p = route[waypoint]; routeCenter.set(p.x,p.y,p.z);
    currentPosition.set(state.x,state.y,state.z); segment.copy(currentPosition).sub(previousPosition);
    const t = clamp(closest.copy(routeCenter).sub(previousPosition).dot(segment) / Math.max(segment.lengthSq(), .001), 0, 1);
    if (closest.copy(previousPosition).addScaledVector(segment,t).distanceTo(routeCenter) < 160) {
      waypoint++; updateRingVisibility(); audio.cue('checkpoint');
      toast(waypoint === route.length ? '航线完成！对准机场跑道，放下起落架、减速着陆。' : `航点 ${waypoint} / 5 完成 · 前往${route[waypoint].name}`, 4500);
    }
  }
  if (state.crashed) finish(false);
  else if (mode === 'challenge' && run.complete) finish(true, 'time');
  else if (state.landed && state.speed < 8) finish(true);
}
function updateCamera(dt) {
  forward.set(Math.sin(state.heading),0,-Math.cos(state.heading));
  side.set(Math.cos(state.heading),0,Math.sin(state.heading));
  const vibration=playing&&!paused&&!finished ? (state.boosting?.07:.015)+Math.max(0,(state.gForce||1)-2)*.008 : 0;
  if (!started) {
    chasePosition.set(state.x+32+Math.sin(clockTime*.09)*8,state.y+9,state.z+32);
    camera.position.lerp(chasePosition,1-Math.exp(-dt*3));
    aim.set(state.x-4,state.y,state.z-18);
    camera.up.set(0,1,0);camera.lookAt(aim);
  } else if(cameraMode===1) {
    const pilot=pilotPosition.copy(aircraft.cockpitViewPoint).applyQuaternion(aircraft.root.quaternion);
    camera.position.set(state.x,state.y,state.z).add(pilot);
    camera.quaternion.copy(aircraft.root.quaternion);
    camera.rotateX(-(innerWidth>=1000&&innerHeight>=600?.27:.105)+Math.sin(clockTime*35)*vibration*.012);
    camera.rotateY(Math.sin(clockTime*29)*vibration*.012);
  } else {
    const distance=cameraMode===2?60:26;
    const elevation=cameraMode===2?23:7;
    chasePosition.set(state.x,state.y+elevation,state.z).addScaledVector(forward,-distance);
    if(cameraMode===2)chasePosition.addScaledVector(side,32);
    camera.position.copy(chasePosition);
    camera.position.y=Math.max(camera.position.y,env.heightAt(camera.position.x,camera.position.z)+4);
    camera.position.addScaledVector(side,Math.sin(clockTime*29)*vibration);
    aim.set(state.x,state.y+1,state.z).addScaledVector(forward,cameraMode===2?8:70);
    camera.up.copy(side).multiplyScalar(Math.sin(state.roll*.12));camera.up.y=Math.cos(state.roll*.12);camera.lookAt(aim);
  }
  const desired=!started?57:cameraMode===1?80+(state.boosting?8:0):cameraMode===2?65:68+clamp((state.speed-60)/22,0,14)+(state.boosting?9:0);
  renderFov=THREE.MathUtils.damp(renderFov,desired,3.5,dt);camera.fov=renderFov;camera.updateProjectionMatrix();
}
function updateMission() {
  const p = route[Math.min(waypoint, route.length - 1)];
  $('flightTimer').textContent = fmtTime(state.elapsed);
  $('missionCount').textContent = mode === 'training' ? `${String(waypoint).padStart(2,'0')} / 05` : `${Math.floor(lowPassScore).toLocaleString()} 分`;
  $('missionProgress').style.width = (mode === 'training' ? waypoint / route.length * 100 : mode === 'challenge' ? Math.min(100,run.elapsed/CHALLENGE_SECONDS*100) : Math.min(100,run.chainTime/18*100)) + '%';
  $('objectiveIcon').textContent = mode !== 'training' ? '∞' : waypoint < 5 ? String(waypoint + 1).padStart(2,'0') : '↙';
  $('objectiveTitle').textContent = mode !== 'training' ? '低空高速挑战' : state.grounded && !state.hasFlown ? '准备起飞' : waypoint < 5 ? p.name : '返回机场着陆';
  $('objectiveHint').textContent = mode !== 'training' ? '保持离地 15–150 米 · 高速掠海积分快' : state.grounded && !state.hasFlown ? '加大油门，210 km/h 后按 S 抬头' : waypoint < 5 ? `穿过导航圆环 · 目标海拔 ${Math.round(p.y * 3.28084)} FT` : '放下起落架，缓慢下降，接地刹车';
  $('nextDistance').textContent = mode !== 'training' || waypoint === 5 ? `机场 ${(Math.hypot(state.x,state.z)/1000).toFixed(1)} KM` : `航点距离 ${(Math.hypot(state.x-p.x,state.z-p.z)/1000).toFixed(1)} KM`;
  $('flightPhase').textContent = state.crashed ? '飞行结束' : state.landed ? '着陆滑跑' : state.grounded ? '地面滑行' : state.verticalSpeed > 1 ? '爬升中' : state.verticalSpeed < -1 ? '下降中' : '平稳巡航';
  $('challengeRemaining').textContent = mode==='challenge' ? `${Math.ceil(Math.max(0,CHALLENGE_SECONDS-run.elapsed))}s` : 'FREE';
  $('comboValue').textContent = `×${run.multiplier}`;
  $('challengeBest').textContent = mode==='challenge' ? `纪录 ${challengeBest}` : `低空 ${Math.floor(run.lowTime)}s`;
  $('challengeHud').classList.toggle('scoring', run.active);
  $('gateCue').textContent = run.active ? `低空积分 +${Math.round((state.speed/18)*(1+(150-(state.y-env.heightAt(state.x,state.z)-2.8))/120)*run.multiplier)}/秒 · 连续 6 秒提升倍率` : run.grace>0 ? '短暂拉起 · 低空倍率保留中' : '离地 15–150 米 · 空速 650 km/h 以上开始连分';
  show('gateCue', mode!=='training' && playing && !paused && !finished);
  let warning = '';
  let groundAhead = false;
  if (!state.grounded && state.speed > 90) {
    for (let seconds=.5; seconds<=3; seconds+=.5) {
      const x=state.x+Math.sin(state.heading)*state.speed*seconds,z=state.z-Math.cos(state.heading)*state.speed*seconds;
      if(env.heightAt(x,z)+40>state.y+state.verticalSpeed*seconds){groundAhead=true;break;}
    }
  }
  if (playing && !finished && !paused) {
    if (state.stall) warning = '失速警告 · 加大油门，压低机头';
    else if (groundAhead || (!state.grounded && state.y - env.heightAt(state.x,state.z) < 65 && state.verticalSpeed < -3)) warning = 'PULL UP · 地形接近，立即拉起';
    else if (state.landed && state.speed >= 8) warning = '已接地 · 收油门，按住空格刹车';
  }
  show('warning', !!warning); if (warning) { $('warning').textContent = warning; if(!state.landed) audio.cue('warning'); }
  if (playing && mode === 'training' && waypoint < route.length && !finished) {
    const v = new THREE.Vector3(p.x,p.y,p.z).project(camera);
    const onscreen = v.z < 1 && Math.abs(v.x)<.85 && Math.abs(v.y)<.7;
    $('ringLabel').style.left = `${clamp((v.x + 1) * .5 * innerWidth, innerWidth*.32, innerWidth*.82)}px`;
    $('ringLabel').style.top = `${clamp((1-v.y)*.5*innerHeight-65,160,innerHeight-245)}px`;
    $('ringLabel').firstElementChild.textContent = `${String(waypoint+1).padStart(2,'0')}`;
    $('ringLabel').lastElementChild.textContent = `${(Math.hypot(state.x-p.x,state.z-p.z)/1000).toFixed(1)} KM`;
    show('ringLabel', onscreen && !paused);
  } else show('ringLabel',false);
}
function renderInstruments() {
  const kmh = Math.round(state.speed * 3.6), feet = Math.round(state.y * 3.28084);
  const degrees = (Math.round(state.heading * 180 / Math.PI) + 360) % 360;
  const vertical = Math.round(state.verticalSpeed * 196.85 / 10) * 10;
  const agl = Math.max(0, Math.round((state.y - (env ? env.heightAt(state.x,state.z) : 9) - 2.8)*3.28084));
  $('speedValue').textContent = kmh; $('altValue').textContent = feet.toLocaleString('en');
  $('headingValue').textContent = String(degrees).padStart(3,'0');
  $('headingTop').textContent = degrees < 5 || degrees > 355 ? 'N' : String(degrees).padStart(3,'0');
  const compass = document.querySelectorAll('.compass-track>span');
  [-30,-15,15,30].forEach((offset,i)=>compass[i].textContent=String((Math.round(degrees/15)*15+offset+360)%360).padStart(3,'0'));
  $('headingDirection').textContent = ['N · 正北','NE · 东北','E · 正东','SE · 东南','S · 正南','SW · 西南','W · 正西','NW · 西北'][Math.round(degrees/45)%8];
  $('vsValue').textContent = vertical > 0 ? `+${vertical}` : vertical;
  $('vsLabel').textContent = Math.abs(vertical)<100?'水平':vertical>0?'↑ 爬升':'↓ 下降';
  $('altAgl').textContent = `离地 ${agl.toLocaleString('en')} FT`;
  $('throttleValue').textContent = `${Math.round(controls.throttle*100)}%`;
  $('speedBar').style.width = `${Math.min(100,kmh/1550*100)}%`;
  $('bottomStatus').textContent = paused ? '飞行已暂停' : !started ? '准备就绪 · 享受飞行' : finished ? '飞行报告已生成' : `辅助${controls.assist?'开启':'关闭'} · 燃油 ${Math.ceil(state.fuel)}%`;
  $('machValue').textContent=`M ${(state.mach||state.speed/343).toFixed(2)}`;
  $('gValue').textContent=`${(state.gForce||1).toFixed(1)} G`;
  $('boostBar').style.width=`${state.boostEnergy??100}%`;
  $('boostLabel').textContent=state.boosting?'加力燃烧':state.boostLocked?'松开加力键重置':(state.boostEnergy??100)<15?'加力冷却':'空格 · 加力';
  $('boostGauge').classList.toggle('boosting',!!state.boosting);
  $('app').classList.toggle('afterburner',!!state.boosting&&playing&&!paused&&!finished);
  $('touchBrake').textContent=state.grounded?'刹车':'加力';
  $('speedValue').classList.toggle('supersonic',state.speed>=343);
  drawAttitude(); drawMap(); if(started) updateMission();
}
function drawAttitude() {
  const c=attitudeCtx, w=220; c.clearRect(0,0,w,w);
  c.save(); c.translate(110,110); c.beginPath();c.arc(0,0,99,0,Math.PI*2);c.clip();
  c.fillStyle='#293e47';c.fillRect(-110,-110,220,220);
  c.rotate(-state.roll); c.translate(0,state.pitch*180);
  c.fillStyle='#6496ab'; c.fillRect(-250,-300,500,300); c.fillStyle='#84755c';c.fillRect(-250,0,500,300);
  c.strokeStyle='#e2e3cd';c.lineWidth=2;c.beginPath();c.moveTo(-200,0);c.lineTo(200,0);c.stroke();
  c.strokeStyle='#dfebdf90';c.lineWidth=1.4;
  for(let i=-3;i<=3;i++){if(!i)continue;c.beginPath();c.moveTo(i%2?-18:-32,i*23);c.lineTo(i%2?18:32,i*23);c.stroke();}
  c.restore();c.save();c.translate(110,110);
  c.strokeStyle='#172e3a';c.lineWidth=13;c.beginPath();c.arc(0,0,101,0,Math.PI*2);c.stroke();
  c.strokeStyle='#91a7ab';c.lineWidth=1;
  for(let i=-3;i<=3;i++){const a=-Math.PI/2+i*.22;c.beginPath();c.moveTo(Math.cos(a)*87,Math.sin(a)*87);c.lineTo(Math.cos(a)*96,Math.sin(a)*96);c.stroke();}
  c.strokeStyle='#ffcb8f';c.lineWidth=5;c.beginPath();c.moveTo(-57,0);c.lineTo(-19,0);c.lineTo(-10,9);c.moveTo(10,9);c.lineTo(19,0);c.lineTo(57,0);c.stroke();c.fillStyle='#ffcb8f';c.beginPath();c.arc(0,0,4,0,Math.PI*2);c.fill();c.restore();
}
function drawMap() {
  if(!env)return;
  const c=mapCtx,w=380,h=260,scale=.020,cx=w/2,cy=h*.5;
  const map=(x,z)=>[cx+(x-state.x*.7)*scale,cy+(z-state.z*.7)*scale];
  c.clearRect(0,0,w,h);c.strokeStyle='#8da8a915';c.lineWidth=1;
  for(let i=0;i<w;i+=38){c.beginPath();c.moveTo(i,0);c.lineTo(i,h);c.stroke();}for(let i=0;i<h;i+=38){c.beginPath();c.moveTo(0,i);c.lineTo(w,i);c.stroke();}
  env.islands.forEach(is=>{const p=map(is.x,is.z);c.fillStyle=is.main?'#44675f':'#355650';c.strokeStyle='#6d9d8260';c.beginPath();c.ellipse(p[0],p[1],is.rx*scale,is.rz*scale,0,0,Math.PI*2);c.fill();c.stroke();});
  const a=map(0,-900),b=map(0,900);c.strokeStyle='#c0d4cd';c.lineWidth=2;c.beginPath();c.moveTo(...a);c.lineTo(...b);c.stroke();
  if(mode==='training'){
    c.setLineDash([5,6]);c.strokeStyle='#e5b67c65';c.lineWidth=1.5;c.beginPath();c.moveTo(...map(0,650));route.forEach(p=>c.lineTo(...map(p.x,p.z)));c.lineTo(...map(0,700));c.stroke();c.setLineDash([]);
    route.forEach((p,i)=>{const v=map(p.x,p.z);c.beginPath();c.arc(...v,i===waypoint?6:3,0,Math.PI*2);c.fillStyle=i<waypoint?'#9ed4b4':i===waypoint?'#f4b781':'#a18f75';c.fill();});
  }
  let p=map(state.x,state.z);p=[clamp(p[0],10,w-10),clamp(p[1],10,h-10)];
  c.save();c.translate(...p);c.rotate(state.heading);c.fillStyle='#ffd29c';c.shadowColor='#ffbd80';c.shadowBlur=8;c.beginPath();c.moveTo(0,-10);c.lineTo(6,7);c.lineTo(0,3);c.lineTo(-6,7);c.closePath();c.fill();c.restore();
}
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt=(now-lastFrame)/1000||.016; const dt=Math.min(.1,rawDt);lastFrame=now;
  if(document.hidden) return;
  if(quality==='auto'&&!qualityReduced&&playing&&!paused&&!finished){slowFrames=rawDt>.031?slowFrames+dt:Math.max(0,slowFrames-dt*.5);if(slowFrames>3){qualityReduced=true;applyQuality();}}
  if(!paused&&!finished)clockTime+=dt;
  if(playing&&!paused&&!finished)flightStep(mode==='challenge'?Math.min(dt,Math.max(0,CHALLENGE_SECONDS-run.elapsed)):dt);
  const cpuStart=frameMetrics?.begin();
  env.update(clockTime, weather, camera);
  aircraft.update(state,clockTime,controls.gear);
  if(!paused)updateCamera(dt);
  cameraEffects.render(scene,camera,state,clockTime,playing&&!paused&&!finished);
  if(now-uiTime>80){renderInstruments();updateAudio();uiTime=now;}
  if(toastExpiry&&now>toastExpiry){show('toast',false);toastExpiry=0;}
  frameMetrics?.end(now,cpuStart,`${playing&&!paused&&!finished?'flight':'menu'}/${quality}/${qualityReduced?'reduced':'full'}/${cameraMode}/${weather}`);
}

$('startBtn').addEventListener('click',begin);
$('retryBtn').addEventListener('click',begin);
$('restartBtn').addEventListener('click',begin);
$('pauseRestart').addEventListener('click',begin);
$('homeBtn').addEventListener('click',home);
$('pauseHome').addEventListener('click',home);
$('pauseBtn').addEventListener('click',()=>pause());
$('resumeBtn').addEventListener('click',()=>pause(false));
$('cameraBtn').addEventListener('click',switchCamera);
$('gearBtn').addEventListener('click',toggleGear);
$('flapsBtn').addEventListener('click',()=>{controls.flaps=!controls.flaps;updateSwitches();toast(controls.flaps?'襟翼已打开 · 低速进近':'襟翼已收起',2200);});
$('assistBtn').addEventListener('click',()=>{controls.assist=!controls.assist;updateSwitches();toast(controls.assist?'飞行辅助已开启 · 松开操控后自动回正':'飞行辅助已关闭',2400);});
$('helpBtn').addEventListener('click',openHelp);
$('closeHelp').addEventListener('click',closeHelp);
$('helpDone').addEventListener('click',closeHelp);
$('throttleSlider').addEventListener('input',e=>{controls.throttle=Number(e.target.value)/100;});
$('throttleSlider').addEventListener('pointerup',e=>e.target.blur());
$('soundBtn').addEventListener('click',()=>{audioWasPaused=paused;if(playing&&!finished)paused=true;resetInputs();show('audioOverlay');syncAudioControls();updateAudio();});
function closeAudio(){show('audioOverlay',false);if(playing&&!finished)pause(audioWasPaused);else updateAudio();}
$('closeAudio').addEventListener('click',closeAudio);
for(const [id,key] of [['musicToggle','musicEnabled'],['sfxToggle','sfxEnabled']])$(id).addEventListener('change',e=>{audio.setPreferences({[key]:e.target.checked});audio.unlock();syncAudioControls();updateAudio();});
for(const [id,key] of [['musicVolume','musicVolume'],['sfxVolume','sfxVolume']])$(id).addEventListener('input',e=>{audio.setPreferences({[key]:Number(e.target.value)/100});audio.unlock();updateAudio();});
$('qualitySelect').addEventListener('change',e=>{quality=e.target.value;qualityReduced=false;slowFrames=0;try{localStorage.setItem('skybound-quality',quality);}catch{}applyQuality();});
$('touchToggle').addEventListener('change',e=>{touchOverride=e.target.checked;try{localStorage.setItem('skybound-touch',touchOverride?'on':'off');}catch{}resetInputs();syncTouch();});
$('endFlightBtn').addEventListener('click',()=>finish(true,'bank'));
async function unlockFromGesture(){if(await audio.unlock()){window.removeEventListener('pointerup',unlockFromGesture);window.removeEventListener('keydown',unlockFromGesture);}}
window.addEventListener('pointerup',unlockFromGesture);window.addEventListener('keydown',unlockFromGesture);

$('fullscreenBtn').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('app').requestFullscreen();}catch{toast('当前窗口无法全屏，可在浏览器中打开游戏。');}});
document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();if(!playing)home();else openHelp();});
document.querySelectorAll('[data-mode]').forEach(btn=>btn.addEventListener('click',()=>{mode=btn.dataset.mode;document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('selected',b===btn);b.setAttribute('aria-pressed',String(b===btn));});drawMap();}));
document.querySelectorAll('[data-weather]').forEach(btn=>btn.addEventListener('click',()=>{weather=btn.dataset.weather;env?.setWeather(weather);document.querySelectorAll('[data-weather]').forEach(b=>{b.classList.toggle('selected',b===btn);b.setAttribute('aria-pressed',String(b===btn));});$('weatherLabel').textContent={clear:'晴空 · 微风',sunset:'日落 · 微风',cloudy:'多云 · 微风'}[weather];}));
const flightKeys=new Set(['KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','ControlLeft','ControlRight','Space','KeyB','KeyG','KeyF','KeyC','KeyP','Escape']);
window.addEventListener('keydown',e=>{
  if(!$('audioOverlay').classList.contains('hidden')){if(e.code==='Escape'){e.preventDefault();closeAudio();}return;}
  if(e.target instanceof HTMLSelectElement || (e.target instanceof HTMLInputElement && e.target.type !== 'range'))return;
  if(e.target instanceof HTMLInputElement && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.code))return;
  if(!$('helpOverlay').classList.contains('hidden')){if(flightKeys.has(e.code))e.preventDefault();if(e.code==='Escape')closeHelp();return;}
  if(flightKeys.has(e.code))e.preventDefault();
  if(e.repeat)return;
  if(e.code==='Escape'){if(!$('helpOverlay').classList.contains('hidden'))closeHelp();else pause();return;}
  if(e.code==='KeyP'){pause();return;}
  if(!playing||paused||finished)return;
  if(e.code==='KeyC')switchCamera();else if(e.code==='KeyG')toggleGear();else if(e.code==='KeyF')$('flapsBtn').click();else keys.add(e.code);
});
window.addEventListener('keyup',e=>keys.delete(e.code));
function backgroundPause(){resetInputs();if(!$('helpOverlay').classList.contains('hidden'))helpWasPaused=true;if(!$('audioOverlay').classList.contains('hidden'))audioWasPaused=true;if(playing&&!finished)pause(true);updateAudio();}
window.addEventListener('blur',backgroundPause);
document.addEventListener('visibilitychange',()=>{if(document.hidden)backgroundPause();resetInputs();lastFrame=performance.now();updateAudio();});
window.addEventListener('resize',()=>{if(!renderer)return;applyQuality();camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
$('world').addEventListener('webglcontextlost',e=>{e.preventDefault();pause(true);toast('图形上下文暂时中断，请刷新页面重新进入。',15000);});
let pointerId=null;
function moveStick(e){const box=$('joystick').getBoundingClientRect();const radius=box.width*.36;let x=(e.clientX-box.left-box.width/2)/radius,y=(e.clientY-box.top-box.height/2)/radius;const len=Math.hypot(x,y);if(len>1){x/=len;y/=len;}touch.roll=x;touch.pitch=y;$('joystickKnob').style.transform=`translate(${x*radius}px,${y*radius}px)`;}
$('joystick').addEventListener('pointerdown',e=>{if(pointerId!==null)return; e.preventDefault(); pointerId=e.pointerId;$('joystick').setPointerCapture(pointerId);moveStick(e);});
$('joystick').addEventListener('pointermove',e=>{if(e.pointerId===pointerId)moveStick(e);});
for(const evt of ['pointerup','pointercancel','lostpointercapture'])$('joystick').addEventListener(evt,()=>{pointerId=null;touch.roll=touch.pitch=0;$('joystickKnob').style.transform='';});
for(const [id,field] of [['touchUp','up'],['touchBrake','brake'],['touchAirbrake','airbrake']]){const btn=$(id);btn.addEventListener('pointerdown',e=>{e.preventDefault();btn.setPointerCapture(e.pointerId);touch[field]=true;});for(const evt of ['pointerup','pointercancel','lostpointercapture'])btn.addEventListener(evt,()=>{touch[field]=false;});}
syncAudioControls(); updateAudio(); audio.unlock();
initialize();
