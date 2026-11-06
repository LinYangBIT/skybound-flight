import * as THREE from './vendor/three.module.js';

/** JX-9: an original twin-engine high performance aircraft, nose along local -Z. */
export function createAircraft(scene) {
  const root = new THREE.Group(); root.name = 'JX-9 coastal interceptor'; scene.add(root);
  const exterior = new THREE.Group(), cockpit = new THREE.Group();
  exterior.name = 'Airframe'; cockpit.name = 'Pilot cockpit'; root.add(exterior, cockpit); cockpit.visible = false;
  const cockpitViewPoint = new THREE.Vector3(0, 1.58, -4.55);
  const clamp = THREE.MathUtils.clamp;
  let seed = 29071;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const surfaceCanvas = document.createElement('canvas'); surfaceCanvas.width = surfaceCanvas.height = 1024;
  const paint = surfaceCanvas.getContext('2d');
  paint.fillStyle = '#9fa7a8'; paint.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 45000; i++) {
    const shade = Math.round(105 + random() * 110);
    paint.fillStyle = `rgba(${shade},${shade},${shade},${.025 + random() * .04})`;
    paint.fillRect(random() * 1024, random() * 1024, 1 + random() * 4, 1 + random() * 8);
  }
  const panels = [[22,24,240,290],[280,24,228,290],[527,24,224,290],[770,24,231,290],[22,332,486,286],[527,332,474,286],[22,638,240,360],[280,638,228,360],[527,638,474,360]];
  paint.lineWidth = 1.5;
  for (const [x,y,w,h] of panels) {
    paint.strokeStyle = '#4f5c5d5e'; paint.strokeRect(x, y, w, h);
    paint.strokeStyle = '#d6ddda5e'; paint.strokeRect(x+2, y+2, w-4, h-4);
    paint.fillStyle = '#414d4d8c';
    for (let n = 10; n < w; n += 25) { paint.fillRect(x+n,y+5,2,2); paint.fillRect(x+n,y+h-7,2,2); }
    for (let n = 10; n < h; n += 25) { paint.fillRect(x+5,y+n,2,2); paint.fillRect(x+w-7,y+n,2,2); }
  }
  for (let i=0; i<22; i++) {
    const x=random()*1024,y=random()*1024,r=20+random()*90;
    const grad=paint.createRadialGradient(x,y,0,x,y,r);grad.addColorStop(0,'rgba(31,39,38,.07)');grad.addColorStop(1,'rgba(31,39,38,0)');paint.fillStyle=grad;paint.fillRect(x-r,y-r,r*2,r*2);
  }
  paint.fillStyle='#3b4544';paint.font='16px monospace';paint.fillText('NO STEP',565,705);paint.font='bold 28px monospace';paint.fillText('JX–09',66,720);
  const surfaceTexture = new THREE.CanvasTexture(surfaceCanvas); surfaceTexture.colorSpace = THREE.SRGBColorSpace; surfaceTexture.anisotropy = 8;
  const material = (color, extra={}) => new THREE.MeshStandardMaterial({color,roughness:.52,metalness:.36,...extra});
  const bodyPaint = material(0x9ea7a8,{map:surfaceTexture,bumpMap:surfaceTexture,bumpScale:.012});
  const wingPaint = material(0x9ca5a5,{map:surfaceTexture,bumpMap:surfaceTexture,bumpScale:.009});
  const darkPaint = material(0x626e70,{map:surfaceTexture,roughness:.57});
  const nosePaint = material(0x758085,{roughness:.66,metalness:.15});
  const black = material(0x070a0c,{roughness:.8,metalness:.1});
  const rubber = material(0x14191a,{roughness:.97,metalness:0});
  const metal = material(0x899192,{roughness:.32,metalness:.85});
  const hotMetal = material(0x5a5550,{roughness:.43,metalness:.85});
  const glass = new THREE.MeshPhysicalMaterial({color:0x244650,roughness:.09,metalness:.56,clearcoat:1,clearcoatRoughness:.05,transparent:true,opacity:.87,envMapIntensity:1.4});
  const navRed = new THREE.MeshBasicMaterial({color:0xc6463c}), navGreen = new THREE.MeshBasicMaterial({color:0x73ac96});
  const smallSphere = new THREE.SphereGeometry(1,24,16);
  const up = new THREE.Vector3(0,1,0);
  const mesh = (geometry,mat,parent=exterior) => { const m=new THREE.Mesh(geometry,mat);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m; };
  const ellipsoid = (mat,x,y,z,sx,sy,sz,parent=exterior) => {const m=mesh(smallSphere,mat,parent);m.position.set(x,y,z);m.scale.set(sx,sy,sz);return m;};
  const rod = (a,b,r,mat,parent=exterior) => {
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);
    const m=mesh(new THREE.CylinderGeometry(r,r,delta.length(),10),mat,parent);m.position.copy(start).add(end).multiplyScalar(.5);m.quaternion.setFromUnitVectors(up,delta.normalize());return m;
  };
  // Smooth elliptical cross-sections form the tapered lifting fuselage.
  function shell(profiles,mat,segments=48,parent=exterior) {
    const p=[],uv=[],ix=[];
    profiles.forEach(([z,rx,ry,cy],j)=>{
      for(let i=0;i<=segments;i++){
        const a=i/segments*Math.PI*2;p.push(Math.cos(a)*rx,Math.sin(a)*ry+cy,z);uv.push(i/segments,j/(profiles.length-1));
        if(j<profiles.length-1&&i<segments){const a0=j*(segments+1)+i,b=a0+segments+1;ix.push(a0,a0+1,b,a0+1,b+1,b);}
      }
    });
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return mesh(g,mat,parent);
  }
  shell([[-10.2,.015,.025,-.05],[-9.6,.20,.22,-.04],[-8.9,.38,.36,-.02],[-8,.57,.49,0],[-7,.70,.59,0],[-6,.80,.64,.02]],nosePaint);
  shell([[-6,.8,.64,.02],[-5,.91,.70,.03],[-3.8,1.03,.73,.04],[-2.5,1.18,.73,.02],[-1,1.42,.68,0],[.8,1.65,.66,-.06],[2.5,1.70,.65,-.08],[4.4,1.46,.63,-.06],[5.8,1.22,.59,-.04],[7,1.08,.48,-.02],[7.8,.98,.40,0]],bodyPaint);
  // A raised spine flows into the canopy and engine deck.
  shell([[-5.7,.04,.04,.61],[-4.7,.62,.56,.68],[-3.6,.75,.72,.64],[-2.4,.67,.60,.61],[-1.1,.45,.29,.65],[1,.32,.14,.67],[4.5,.18,.08,.60]],darkPaint,32);
  const canopy=ellipsoid(glass,0,1.03,-3.95,.72,.78,1.78);canopy.rotation.x=-.035;
  // Fine canopy sills and bow are visible as black rubber seams, not bright outline art.
  for(const side of [-1,1]){
    rod([side*.59,.81,-5.25],[side*.7,.91,-3.85],.025,darkPaint);
    rod([side*.7,.91,-3.85],[side*.53,.79,-2.55],.025,darkPaint);
  }
  const bowPoints=[];
  for(let i=0;i<=30;i++){const a=Math.PI*i/30;bowPoints.push(new THREE.Vector3(Math.cos(a)*.72,.95+Math.sin(a)*.74,-3.6));}
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bowPoints),30,.025,6,false),darkPaint);
  ellipsoid(black,0,.88,-3.7,.34,.53,.42);
  // Closed thin aerofoil surfaces. Polygon footprint lies in XZ; bevels catch sunlight.
  function surface(outline,thickness,mat,parent=exterior){
    const p=[],uv=[],ix=[],count=outline.length;
    for(const s of [-1,1])for(const [x,y,z]of outline){p.push(x,y+s*thickness*.5,z);uv.push((x+7)/14,(z+10)/20);}
    for(let i=1;i<count-1;i++){ix.push(0,i,i+1,count,count+i+1,count+i);}
    for(let i=0;i<count;i++){const n=(i+1)%count;ix.push(i,count+i,n,n,count+i,count+n);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();
    return mesh(g,mat,parent);
  }
  for(const side of [-1,1]) {
    const wingOutline=[[side*.97,.08,-2.5],[side*2.12,.02,-1.85],[side*6.5,-.10,2.15],[side*6.48,-.10,3.23],[side*3.17,.03,3.54],[side*1.30,.09,4.10]];
    // Reverse mirrored winding so outward normals remain correct on both wings.
    if(side<0)wingOutline.reverse();surface(wingOutline,.15,wingPaint);
    const lerx=[[side*.78,.25,-4.8],[side*1.37,.11,-2.4],[side*2.8,.07,-.8],[side*1.36,.17,.30]];if(side<0)lerx.reverse();surface(lerx,.10,bodyPaint);
    const tail=[[side*.77,.31,4.72],[side*3.66,.10,6.35],[side*3.54,.10,7.50],[side*1.03,.28,7.40]];if(side<0)tail.reverse();surface(tail,.13,wingPaint);
    rod([side*2.27,.13,2.3],[side*5.78,-.02,2.91],.009,darkPaint);
    rod([side*1.72,.19,.7],[side*5.82,-.02,2.10],.009,darkPaint);
    // Tiny navigation lights, embedded at the swept tips.
    ellipsoid(side<0?navRed:navGreen,side*6.5,-.07,2.8,.10,.055,.12);
    // Intakes are inset under the wing roots with a dark recessed face.
    const intake=shell([[-3.4,.57,.44,-.37],[-2.8,.66,.46,-.40],[-1.2,.67,.47,-.42],[1.8,.68,.49,-.38],[4.3,.63,.52,-.19],[6.9,.57,.54,-.04]],bodyPaint,32);intake.position.x=side*1.04;
    const lip=mesh(new THREE.TorusGeometry(.47,.07,8,32),metal);lip.position.set(side*1.04,-.39,-3.42);lip.scale.x=1.19;
    const mouth=mesh(new THREE.CircleGeometry(.47,32),black);mouth.rotation.y=Math.PI;mouth.position.set(side*1.04,-.39,-3.43);mouth.scale.x=1.19;
    // Twin vertical stabilizers, canted outward and swept aft.
    const finGroup=new THREE.Group();finGroup.position.set(side*.99,.30,4.75);finGroup.rotation.z=-side*.24;exterior.add(finGroup);
    const finShape=new THREE.Shape();finShape.moveTo(0,0);finShape.lineTo(1.35,2.92);finShape.lineTo(2.05,3.02);finShape.lineTo(3.06,.20);finShape.closePath();
    const finGeo=new THREE.ExtrudeGeometry(finShape,{depth:.11,bevelEnabled:true,bevelThickness:.015,bevelSize:.025,bevelSegments:1,steps:1});
    // Shape X maps to aircraft Z, shape Y stays vertical; thickness maps to X.
    finGeo.rotateY(-Math.PI/2);const f=mesh(finGeo,wingPaint,finGroup);f.position.x=.055;
    // An understated dark panel identifies each fin without bright livery.
    const finBand=mesh(new THREE.BoxGeometry(.115,.15,.9),darkPaint,finGroup);finBand.position.set(0,2.50,1.70);
    rod([side*1.3,-.72,2.0],[side*1.3,-.95,3.7],.035,metal);
  }
  // Bare-metal variable exhaust petals, with dark recessed turbine bores.
  const exhausts=[];
  for(const side of [-1,1]) {
    const centerX=side*.72;
    const nozzle=shell([[6.45,.58,.58,0],[7.15,.61,.61,0],[7.95,.48,.48,0],[8.22,.46,.46,0]],hotMetal,32);nozzle.position.x=centerX;
    const lip=mesh(new THREE.TorusGeometry(.465,.037,8,32),metal);lip.position.set(centerX,0,8.20);
    const darkCenter=mesh(new THREE.CircleGeometry(.445,32),black);darkCenter.position.set(centerX,0,8.08);
    const petalPositions=[];
    for(let i=0;i<16;i++){
      const a=i/16*Math.PI*2;
      petalPositions.push(centerX+Math.cos(a)*.612,Math.sin(a)*.612,7.14,centerX+Math.cos(a)*.47,Math.sin(a)*.47,8.18);
    }
    const seams=new THREE.BufferGeometry();seams.setAttribute('position',new THREE.Float32BufferAttribute(petalPositions,3));
    exterior.add(new THREE.LineSegments(seams,new THREE.LineBasicMaterial({color:0x272b2d,transparent:true,opacity:.55})));
    const exhaustMaterial=new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
      uniforms:{time:{value:0},power:{value:0}},
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`varying vec2 vUv;uniform float time,power;
        void main(){float axial=vUv.y;float radial=pow(max(0.,1.-abs(vUv.x-.5)*2.),.7);
          float shock=.68+.32*sin(axial*52.-time*19.);float turbulence=.8+.2*sin(vUv.x*47.+axial*31.-time*33.);
          vec3 col=mix(vec3(.23,.43,1.),vec3(1.,.42,.13),smoothstep(.1,.65,axial));
          float alpha=power*pow(max(0.,1.-axial),1.7)*radial*shock*turbulence*.62;
          gl_FragColor=vec4(col,alpha);}`
    });
    const flame=mesh(new THREE.CylinderGeometry(.06,.42,3.8,24,16,true),exhaustMaterial);
    flame.rotation.x=Math.PI/2;flame.position.set(centerX,0,10.05);flame.castShadow=false;flame.visible=false;exhausts.push(flame);
  }
  // Tricycle gear: tyre bottom at local -2.70, matching the runway elevation.
  const gearGroup=new THREE.Group();exterior.add(gearGroup);
  for(const side of [-1,1]) {
    rod([side*1.02,-.55,1.24],[side*1.75,-2.15,1.54],.095,metal,gearGroup);
    rod([side*1.02,-.58,2.3],[side*1.75,-1.88,1.54],.055,metal,gearGroup);
    const tyre=mesh(new THREE.CylinderGeometry(.55,.55,.34,24),rubber,gearGroup);tyre.rotation.z=Math.PI/2;tyre.position.set(side*1.83,-2.15,1.54);
    const hub=mesh(new THREE.CylinderGeometry(.28,.28,.36,16),metal,gearGroup);hub.rotation.z=Math.PI/2;hub.position.copy(tyre.position);
    const door=mesh(new THREE.BoxGeometry(.05,.91,.63),bodyPaint,gearGroup);door.position.set(side*1.27,-1.24,1.55);door.rotation.z=side*.35;
  }
  rod([0,-.55,-5.55],[0,-2.27,-5.56],.078,metal,gearGroup);
  const noseWheel=mesh(new THREE.CylinderGeometry(.43,.43,.26,24),rubber,gearGroup);noseWheel.rotation.z=Math.PI/2;noseWheel.position.set(0,-2.27,-5.56);
  const noseHub=mesh(new THREE.CylinderGeometry(.20,.20,.28,16),metal,gearGroup);noseHub.rotation.z=Math.PI/2;noseHub.position.copy(noseWheel.position);
  rod([0,-.7,-6.2],[0,-1.85,-5.56],.045,metal,gearGroup);
  const pitot=rod([0,-.04,-10.1],[0,-.04,-11.0],.018,metal);pitot.castShadow=false;
  rod([0,.77,1.3],[0,1.35,1.72],.025,darkPaint);

  // Cockpit interior is drawn only in first-person; it uses live instrument displays.
  const cockpitMat=material(0x11191d,{roughness:.86,metalness:.16});
  const cockpitMetal=material(0x354048,{roughness:.57,metalness:.32});
  const dashboard=mesh(new THREE.BoxGeometry(1.94,.69,.42),cockpitMat,cockpit);dashboard.position.set(0,.52,-5.83);dashboard.rotation.x=-.12;
  const glareShield=mesh(new THREE.BoxGeometry(2.03,.10,.77),cockpitMat,cockpit);glareShield.position.set(0,.90,-5.84);glareShield.rotation.x=-.08;
  for(const side of [-1,1]) {
    rod([side*.87,.69,-5.54],[side*.87,1.18,-5.79],.047,cockpitMetal,cockpit);
    rod([side*.87,1.18,-5.79],[side*.71,2.20,-5.67],.045,cockpitMetal,cockpit);
    rod([side*.71,2.20,-5.67],[side*.36,2.52,-5.49],.038,cockpitMetal,cockpit);
    const console=mesh(new THREE.BoxGeometry(.32,.48,1.9),cockpitMat,cockpit);console.position.set(side*.91,.25,-4.65);
  }
  rod([-.36,2.52,-5.49],[.36,2.52,-5.49],.038,cockpitMetal,cockpit);
  // A transparent HUD combiner catches a small amount of sky, leaving visibility intact.
  const hudGlass=mesh(new THREE.PlaneGeometry(.58,.41),new THREE.MeshPhysicalMaterial({color:0x7bada7,transparent:true,opacity:.065,roughness:.05,metalness:.1,side:THREE.DoubleSide,depthWrite:false}),cockpit);
  hudGlass.position.set(0,1.22,-6.02);hudGlass.rotation.x=-.13;hudGlass.castShadow=false;
  const instrumentCanvas=document.createElement('canvas');instrumentCanvas.width=1024;instrumentCanvas.height=384;
  const instrumentCtx=instrumentCanvas.getContext('2d');const instrumentTexture=new THREE.CanvasTexture(instrumentCanvas);instrumentTexture.colorSpace=THREE.SRGBColorSpace;
  const instruments=mesh(new THREE.PlaneGeometry(1.76,.59),new THREE.MeshBasicMaterial({map:instrumentTexture}),cockpit);instruments.position.set(0,.51,-5.59);instruments.rotation.x=-.12;instruments.castShadow=false;
  let lastPanelTime=-10;
  function drawInstruments(state,time){
    if(time-lastPanelTime<.15&&time>=lastPanelTime)return;lastPanelTime=time;
    const c=instrumentCtx;c.fillStyle='#0c1115';c.fillRect(0,0,1024,384);
    for(const x of [20,360,700]){
      c.fillStyle='#232b2e';c.fillRect(x,20,304,340);c.fillStyle='#020907';c.fillRect(x+16,36,272,308);
      c.fillStyle='#5b676a';for(let y=62;y<330;y+=47){c.fillRect(x+3,y,9,18);c.fillRect(x+292,y,9,18);}
    }
    c.font='18px monospace';c.fillStyle='#9ac6ad';c.fillText('AIR DATA',52,68);c.fillText('ATTITUDE',392,68);c.fillText('ENGINE / NAV',732,68);
    c.font='bold 45px monospace';c.fillText(String(Math.round((state.speed||0)*3.6)).padStart(3,'0'),62,144);
    c.font='17px monospace';c.fillText('KM/H',204,144);c.fillText(`M ${(state.mach??((state.speed||0)/343)).toFixed(2)}`,62,192);
    c.fillText(`${Math.round((state.y||0)*3.28084)} FT`,62,240);c.fillText(`${Math.round((state.verticalSpeed||0)*196.85)} FPM`,62,285);
    c.save();c.beginPath();c.rect(382,87,260,225);c.clip();c.translate(512,200);c.rotate(-(state.roll||0));c.translate(0,(state.pitch||0)*130);
    c.fillStyle='#294c5b';c.fillRect(-250,-300,500,300);c.fillStyle='#5a4e36';c.fillRect(-250,0,500,300);c.strokeStyle='#abbda6';c.lineWidth=2;c.beginPath();c.moveTo(-200,0);c.lineTo(200,0);c.stroke();c.restore();
    c.strokeStyle='#d7cd96';c.lineWidth=3;c.beginPath();c.moveTo(449,200);c.lineTo(488,200);c.moveTo(536,200);c.lineTo(575,200);c.stroke();
    c.fillStyle='#9ac6ad';c.font='19px monospace';c.fillText(`HDG ${String((Math.round((state.heading||0)*180/Math.PI)+360)%360).padStart(3,'0')}`,744,126);
    c.fillText(`N1  ${Math.round((state.throttle||0)*100)} %`,744,171);c.fillText(`FUEL ${Math.ceil(state.fuel??100)} %`,744,215);c.fillText(`G    ${(state.gForce??1).toFixed(1)}`,744,259);
    c.fillStyle=state.boosting?'#d4a56b':'#6f9981';c.fillText(state.boosting?'AFTERBURNER':'ENGINE NORMAL',732,313);
    instrumentTexture.needsUpdate=true;
  }
  drawInstruments({speed:0,y:11.8,heading:0,pitch:0,roll:0,throttle:0,fuel:100},0);
  let heat=0;
  function update(state,time,gear=state.gear){
    root.position.set(state.x,state.y,state.z);root.rotation.set(state.pitch,-state.heading,-state.roll,'YXZ');
    gearGroup.visible=gear!==false;
    heat+=(Number(!!state.boosting)-heat)*.17;
    for(const flame of exhausts){flame.visible=heat>.015&&!state.crashed;flame.material.uniforms.time.value=time;flame.material.uniforms.power.value=heat;flame.scale.y=.95+Math.sin(time*34)*.035;}
    if(cockpit.visible)drawInstruments(state,time);
  }
  function setCockpit(enabled){exterior.visible=!enabled;cockpit.visible=enabled;root.visible=true;}
  return {root,update,setCockpit,cockpitViewPoint};
}
