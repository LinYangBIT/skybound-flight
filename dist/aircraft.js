import * as THREE from './vendor/three.module.js';
import { createAirframeMaterials, batchStaticMeshes } from './aircraft-surfaces.js?v=4';

/** JX-9: an original twin-engine high performance aircraft, nose along local -Z. */
export function createAircraft(scene) {
  const root = new THREE.Group(); root.name = 'JX-9 coastal interceptor'; scene.add(root);
  const exterior = new THREE.Group(), cockpit = new THREE.Group();
  exterior.name = 'Airframe'; cockpit.name = 'Pilot cockpit'; root.add(exterior, cockpit); cockpit.visible = false;
  const cockpitViewPoint = new THREE.Vector3(0, 1.58, -4.55);
  const clamp = THREE.MathUtils.clamp;
  const {bodyPaint,wingPaint,darkPaint,nosePaint,black,rubber,metal,hotMetal,hotEdge,hotInner,glass,navRed,navGreen}=createAirframeMaterials();
  const material = (color,extra={}) => new THREE.MeshStandardMaterial({color,roughness:.58,metalness:.16,...extra});
  const movingSurfaces=[];
  const smallSphere = new THREE.SphereGeometry(1,24,16);
  const up = new THREE.Vector3(0,1,0);
  const mesh = (geometry,mat,parent=exterior) => { const m=new THREE.Mesh(geometry,mat);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m; };
  const ellipsoid = (mat,x,y,z,sx,sy,sz,parent=exterior) => {const m=mesh(smallSphere,mat,parent);m.position.set(x,y,z);m.scale.set(sx,sy,sz);return m;};
  const rod = (a,b,r,mat,parent=exterior) => {
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);
    const m=mesh(new THREE.CylinderGeometry(r,r,delta.length(),10),mat,parent);m.position.copy(start).add(end).multiplyScalar(.5);m.quaternion.setFromUnitVectors(up,delta.normalize());return m;
  };
  // Smooth elliptical cross-sections form the tapered lifting fuselage.
  function shell(profiles,mat,segments=48,parent=exterior,power=1) {
    const p=[],uv=[],ix=[];
    profiles.forEach(([z,rx,ry,cy,cx=0],j)=>{
      for(let i=0;i<=segments;i++){
        const a=i/segments*Math.PI*2;p.push(Math.sign(Math.cos(a))*Math.pow(Math.abs(Math.cos(a)),power)*rx+cx,Math.sign(Math.sin(a))*Math.pow(Math.abs(Math.sin(a)),power)*ry+cy,z);uv.push(i/segments,j/(profiles.length-1));
        if(j<profiles.length-1&&i<segments){const a0=j*(segments+1)+i,b=a0+segments+1;ix.push(a0,a0+1,b,a0+1,b+1,b);}
      }
    });
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return mesh(g,mat,parent);
  }
  shell([[-10.2,.015,.025,-.05],[-9.6,.20,.22,-.04],[-8.9,.38,.36,-.02],[-8,.57,.49,0],[-7,.70,.59,0],[-6,.80,.64,.02]],nosePaint);
  shell([[-6,.8,.64,.02],[-5,.91,.70,.03],[-3.8,1.03,.73,.04],[-2.5,1.18,.73,.02],[-1,1.42,.68,0],[.8,1.65,.66,-.06],[2.5,1.70,.65,-.08],[4.4,1.46,.63,-.06],[5.8,1.12,.56,-.02],[6.7,.72,.40,.04],[7.4,.31,.24,.10],[7.8,.10,.12,.12]],bodyPaint);
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
  // Seat shell, head restraint and pilot helmet give the canopy a readable interior.
  const seat=mesh(new THREE.BoxGeometry(.53,.84,.23),black);seat.position.set(0,.79,-3.27);seat.rotation.x=.16;
  ellipsoid(rubber,0,1.25,-3.23,.25,.19,.15);
  ellipsoid(darkPaint,0,.96,-3.63,.28,.37,.24);
  ellipsoid(nosePaint,0,1.45,-3.62,.20,.23,.22);
  const visor=ellipsoid(black,0,1.47,-3.785,.175,.105,.105);visor.castShadow=false;
  for(const side of [-1,1]) rod([side*.16,1.15,-3.83],[side*.12,.72,-3.86],.023,hotEdge);

  // Four cross-section rings give the wings a thin bevel and camber. The sharp trailing
  // edge stays thin at flying distance; it is not a uniformly thick extruded slab.
  function surface(outline,thickness,mat,parent=exterior){
    const positions=[],uvs=[],indices=[],n=outline.length;
    const center=outline.reduce((c,p)=>c.add(new THREE.Vector3(...p)),new THREE.Vector3()).multiplyScalar(1/n);
    const rings=[[-.5,.985],[-.08,1],[.08,1],[.5,.985]];
    for(const [height,inset] of rings) for(const [x,y,z] of outline) {
      const taper=1-Math.min(1,Math.abs(x)/7)*.6;
      positions.push(center.x+(x-center.x)*inset,y+height*thickness*taper,center.z+(z-center.z)*inset);
      uvs.push((x+7)/14,(z+10)/20);
    }
    for(let ring=0;ring<3;ring++) for(let i=0;i<n;i++) {
      const next=(i+1)%n,a=ring*n+i,b=ring*n+next,c=(ring+1)*n+i,d=(ring+1)*n+next;
      indices.push(a,c,b,b,c,d);
    }
    for(let i=1;i<n-1;i++) {indices.push(0,i,i+1,3*n,3*n+i+1,3*n+i);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
    return mesh(geometry,mat,parent);
  }
  function controlSurface(outline,axisStart,axisEnd,side,kind){
    if(side<0){outline.reverse();outline.unshift(outline.pop());}
    const pivot=new THREE.Group(), origin=new THREE.Vector3(...axisStart), axis=new THREE.Vector3(...axisEnd).sub(origin).normalize();
    exterior.add(pivot);pivot.position.copy(origin);
    const model=surface(outline.map(p=>[p[0]-origin.x,p[1]-origin.y,p[2]-origin.z]),.12,wingPaint,pivot);
    movingSurfaces.push({pivot,axis,side,kind});return model;
  }
  for(const side of [-1,1]) {
    const wingOutline=[[side*.97,.08,-2.5],[side*2.12,.02,-1.85],[side*6.5,-.10,2.15],[side*6.49,-.10,2.70],[side*3.14,.03,2.94],[side*1.30,.09,3.57]];
    if(side<0){wingOutline.reverse();wingOutline.unshift(wingOutline.pop());}surface(wingOutline,.23,wingPaint);
    const lerx=[[side*.78,.25,-4.8],[side*1.37,.11,-2.4],[side*2.8,.07,-.8],[side*1.36,.17,.30]];if(side<0){lerx.reverse();lerx.unshift(lerx.pop());}surface(lerx,.12,bodyPaint);
    controlSurface([[side*3.17,.03,2.985],[side*6.48,-.10,2.745],[side*6.48,-.10,3.23],[side*3.17,.03,3.54]],[side*3.17,.03,2.985],[side*6.48,-.10,2.745],side,'aileron');
    controlSurface([[side*1.30,.09,3.61],[side*3.12,.03,3.01],[side*3.12,.03,3.55],[side*1.30,.09,4.10]],[side*1.30,.09,3.61],[side*3.12,.03,3.01],side,'flap');
    const tail=[[side*.77,.31,4.72],[side*3.66,.10,6.35],[side*3.54,.10,7.50],[side*1.03,.28,7.40]];if(side<0){tail.reverse();tail.unshift(tail.pop());}surface(tail,.18,wingPaint);
    // A narrow exposed leading edge catches the sun without tracing every outline.
    rod([side*2.2,.025,-1.73],[side*6.45,-.10,2.13],.012,hotEdge);
    ellipsoid(side<0?navRed:navGreen,side*6.5,-.07,2.8,.095,.055,.11);
    // A rounded rectangular inlet has a real lip, a recessed duct and a hidden compressor.
    const intake=shell([[-3.58,.58,.39,-.43],[-3.44,.61,.42,-.43],[-2.78,.65,.45,-.43],[-1.1,.67,.47,-.40],[1.8,.68,.49,-.34],[4.3,.61,.52,-.15],[6.88,.57,.54,-.04,-side*.20]],bodyPaint,32,exterior,.72);intake.position.x=side*1.04;
    const intakeLip=shell([[-3.59,.505,.318,-.43],[-3.65,.545,.36,-.43],[-3.59,.58,.39,-.43]],hotEdge,32,exterior,.72);intakeLip.position.x=side*1.04;
    const inlet=shell([[-3.59,.505,.318,-.43],[-3.17,.45,.28,-.43],[-2.83,.38,.24,-.43]],hotInner,32,exterior,.72);inlet.position.x=side*1.04;
    const inletBack=mesh(new THREE.CircleGeometry(.39,24),black);inletBack.rotation.y=Math.PI;inletBack.position.set(side*1.04,-.43,-2.82);inletBack.scale.y=.63;
    // Splitter plate is separated from the inlet, with a tapered structural thickness.
    const splitter=mesh(new THREE.BoxGeometry(.033,.66,1.04),darkPaint);splitter.position.set(side*.445,-.38,-3.16);splitter.rotation.y=-side*.045;
    const finGroup=new THREE.Group();finGroup.position.set(side*.99,.30,4.75);finGroup.rotation.z=-side*.24;exterior.add(finGroup);
    const finShape=new THREE.Shape();finShape.moveTo(0,0);finShape.lineTo(1.35,2.92);finShape.lineTo(2.05,3.02);finShape.lineTo(1.93,2.60);finShape.lineTo(2.63,.20);finShape.lineTo(3.06,.04);finShape.closePath();
    const finGeo=new THREE.ExtrudeGeometry(finShape,{depth:.09,bevelEnabled:true,bevelThickness:.018,bevelSize:.018,bevelSegments:2,steps:1});finGeo.rotateY(-Math.PI/2);const fin=mesh(finGeo,wingPaint,finGroup);fin.position.x=.045;
    const rudderShape=new THREE.Shape();rudderShape.moveTo(1.98,2.58);rudderShape.lineTo(2.16,2.65);rudderShape.lineTo(3.06,.20);rudderShape.lineTo(2.68,.20);rudderShape.closePath();
    const rudderGeometry=new THREE.ExtrudeGeometry(rudderShape,{depth:.075,bevelEnabled:true,bevelThickness:.012,bevelSize:.012,bevelSegments:1,steps:1});rudderGeometry.rotateY(-Math.PI/2);const rudder=mesh(rudderGeometry,darkPaint,finGroup);rudder.position.x=.038;
    const finBand=mesh(new THREE.BoxGeometry(.13,.12,.62),darkPaint,finGroup);finBand.position.set(0,2.50,1.64);
    // The engine deck has shallow cooling louvers with raised lips and dark recesses.
    for(let i=0;i<7;i++) {
      const vent=mesh(new THREE.BoxGeometry(.30,.018,.063),black);vent.position.set(side*.80,.655,1.18+i*.15);
      const lip=mesh(new THREE.BoxGeometry(.32,.027,.022),hotEdge);lip.position.set(side*.80,.673,1.15+i*.15);
    }
    rod([side*1.3,-.72,2.0],[side*1.3,-.95,3.7],.035,metal);
  }
  // Bare-metal variable exhaust petals, with dark recessed turbine bores.
  const exhausts=[];
  for(const side of [-1,1]) {
    const centerX=side*.83;
    const nozzle=shell([[6.45,.57,.57,0],[6.87,.62,.62,0],[7.16,.60,.60,0]],hotMetal,40);nozzle.position.x=centerX;
    const collar=mesh(new THREE.TorusGeometry(.606,.025,8,40),hotEdge);collar.position.set(centerX,0,6.94);
    // Twenty individually thick petals form the contracting nozzle, including their
    // inner surfaces. Alternating tempered metal is confined to the exhaust assembly.
    for(let petal=0;petal<20;petal++) {
      const positions=[],uvs=[],indices=[],segments=3,angle=petal/20*Math.PI*2,half=Math.PI/20*.945;
      for(const inner of [false,true]) for(const [z,radius] of [[7.12,.60],[7.43,.55],[8.23,.435]]) for(let n=0;n<=segments;n++) {
        const theta=angle-half+2*half*n/segments,r=radius-(inner?.024:0);
        positions.push(centerX+Math.cos(theta)*r,Math.sin(theta)*r,z);uvs.push(n/segments,(z-7.12)/1.11);
      }
      for(let inner=0;inner<2;inner++) for(let ring=0;ring<2;ring++) for(let n=0;n<segments;n++) {
        const a=inner*12+ring*4+n,b=a+4;
        if(inner)indices.push(a,b,a+1,a+1,b,b+1);else indices.push(a,a+1,b,a+1,b+1,b);
      }
      for(const n of [0,3]) for(let ring=0;ring<2;ring++) {
        const a=ring*4+n,b=a+4; if(n===0) indices.push(a,b,a+12,b,b+12,a+12);else indices.push(a,a+12,b,b,a+12,b+12);
      }
      for(const ring of [0,2]) for(let n=0;n<3;n++) {
        const a=ring*4+n; if(ring===0)indices.push(a,a+12,a+1,a+1,a+12,a+13);else indices.push(a,a+1,a+12,a+1,a+13,a+12);
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
      mesh(geometry,petal%4===0?hotEdge:hotMetal);
      const actuator=rod([centerX+Math.cos(angle)*.63,Math.sin(angle)*.63,6.99],[centerX+Math.cos(angle)*.56,Math.sin(angle)*.56,7.57],.016,metal);actuator.castShadow=false;
    }
    const bore=shell([[6.64,.35,.35,0],[7.04,.46,.46,0],[8.19,.40,.40,0]],hotInner,40);bore.position.x=centerX;
    const turbineBack=mesh(new THREE.CircleGeometry(.35,32),black);turbineBack.position.set(centerX,0,6.64);
    const flameHolder=mesh(new THREE.TorusGeometry(.265,.018,6,32),hotMetal);flameHolder.position.set(centerX,0,6.77);
    for(let blade=0;blade<8;blade++) {
      const angle=blade*Math.PI/4;
      rod([centerX+Math.cos(angle)*.08,Math.sin(angle)*.08,6.75],[centerX+Math.cos(angle+.2)*.33,Math.sin(angle+.2)*.33,6.75],.014,hotMetal);
    }
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
  // Tricycle gear: tyre bottom remains exactly -2.70, matching runway contact.
  const gearGroup=new THREE.Group();exterior.add(gearGroup);
  function wheel(x,y,z,radius,width) {
    const shoulder=.065;
    const tyre=mesh(new THREE.TorusGeometry(radius-shoulder,shoulder,8,32),rubber,gearGroup);
    tyre.rotation.y=Math.PI/2;tyre.position.set(x,y,z);tyre.scale.z=width/(shoulder*2);
    const sidewall=mesh(new THREE.CylinderGeometry(radius-shoulder,radius-shoulder,width*.88,32),rubber,gearGroup);sidewall.rotation.z=Math.PI/2;sidewall.position.set(x,y,z);
    const hub=mesh(new THREE.CylinderGeometry(radius*.48,radius*.48,width*1.03,20),metal,gearGroup);hub.rotation.z=Math.PI/2;hub.position.set(x,y,z);
    for(const side of [-1,1]) {
      const brake=mesh(new THREE.TorusGeometry(radius*.29,.025,6,20),hotMetal,gearGroup);brake.rotation.y=Math.PI/2;brake.position.set(x+side*width*.53,y,z);
      for(let bolt=0;bolt<6;bolt++) {
        const angle=bolt*Math.PI/3;
        const cap=mesh(new THREE.CylinderGeometry(.025,.025,.022,6),hotEdge,gearGroup);cap.rotation.z=Math.PI/2;cap.position.set(x+side*width*.54,y+Math.cos(angle)*radius*.32,z+Math.sin(angle)*radius*.32);
      }
    }
  }
  for(const side of [-1,1]) {
    rod([side*1.02,-.55,1.24],[side*1.55,-1.64,1.46],.115,darkPaint,gearGroup);
    rod([side*1.55,-1.56,1.46],[side*1.75,-2.15,1.54],.067,metal,gearGroup);
    rod([side*1.02,-.58,2.3],[side*1.75,-1.88,1.54],.055,metal,gearGroup);
    rod([side*1.47,-1.30,1.50],[side*1.69,-1.59,1.75],.035,hotEdge,gearGroup);
    rod([side*1.69,-1.59,1.75],[side*1.71,-1.98,1.55],.035,hotEdge,gearGroup);
    rod([side*1.07,-.58,1.38],[side*1.79,-2.07,1.69],.017,rubber,gearGroup);
    wheel(side*1.83,-2.15,1.54,.55,.34);
    const door=mesh(new THREE.BoxGeometry(.055,.91,.63),bodyPaint,gearGroup);door.position.set(side*1.27,-1.24,1.55);door.rotation.z=side*.35;
    const doorBack=mesh(new THREE.BoxGeometry(.02,.68,.43),darkPaint,gearGroup);doorBack.position.set(side*1.26,-1.24,1.55);doorBack.rotation.z=side*.35;
    const bay=mesh(new THREE.BoxGeometry(.58,.025,1.04),black);bay.position.set(side*1.05,-.67,1.55);
  }
  rod([0,-.55,-5.55],[0,-1.74,-5.56],.103,darkPaint,gearGroup);
  rod([0,-1.66,-5.56],[0,-2.27,-5.56],.057,metal,gearGroup);
  wheel(0,-2.27,-5.56,.43,.26);
  rod([0,-.7,-6.2],[0,-1.85,-5.56],.045,metal,gearGroup);
  rod([0,-1.47,-5.65],[0,-1.79,-5.81],.031,hotEdge,gearGroup);
  rod([0,-1.79,-5.81],[0,-2.1,-5.65],.031,hotEdge,gearGroup);
  for(const side of [-1,1]) {
    const noseDoor=mesh(new THREE.BoxGeometry(.025,.35,.93),bodyPaint,gearGroup);noseDoor.position.set(side*.30,-.82,-5.60);noseDoor.rotation.z=side*.45;
  }
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
  // Individual display recesses and tactile controls retain depth in the pilot view.
  const bezelMaterial=material(0x273138,{roughness:.63,metalness:.28});
  const switchMaterial=material(0x7d898b,{roughness:.39,metalness:.65});
  const cautionMaterial=material(0xa59769,{roughness:.62,metalness:.08});
  for(const centerX of [-.584,0,.584]) {
    for(const side of [-1,1]) {
      const vertical=mesh(new THREE.BoxGeometry(.023,.55,.035),bezelMaterial,cockpit);vertical.position.set(centerX+side*.246,.51,-5.562);vertical.rotation.x=-.12;
      const horizontal=mesh(new THREE.BoxGeometry(.516,.023,.035),bezelMaterial,cockpit);horizontal.position.set(centerX,.51+side*.265,-5.562+side*.0318);horizontal.rotation.x=-.12;
      for(let button=0;button<5;button++) {
        const y=.31+button*.09;
        const control=mesh(new THREE.BoxGeometry(.025,.039,.023),rubber,cockpit);control.position.set(centerX+side*.267,y,-5.545+(y-.51)*.12);control.rotation.x=-.12;
      }
      for(const y of [.25,.77]) {
        const fastener=mesh(new THREE.CylinderGeometry(.009,.009,.012,6),switchMaterial,cockpit);fastener.rotation.x=Math.PI/2;fastener.position.set(centerX+side*.246,y,-5.535+(y-.51)*.12);
      }
    }
    const key=mesh(new THREE.CylinderGeometry(.028,.028,.038,12),rubber,cockpit);key.rotation.x=Math.PI/2;key.position.set(centerX+.18,.19,-5.53);
  }
  for(const side of [-1,1]) {
    // Side-console panel, guarded switches, and a throttle quadrant.
    const panel=mesh(new THREE.BoxGeometry(.25,.018,1.32),bezelMaterial,cockpit);panel.position.set(side*.91,.504,-4.70);
    for(let row=0;row<6;row++) for(let column=0;column<2;column++) {
      const x=side*.91+(column-.5)*.12,z=-5.20+row*.19;
      const base=mesh(new THREE.CylinderGeometry(.025,.025,.014,10),rubber,cockpit);base.position.set(x,.52,z);
      rod([x,.53,z],[x,.575,z-.022],.007,switchMaterial,cockpit);
      if(row===0) {
        rod([x-.032,.52,z-.035],[x-.032,.59,z-.035],.006,cautionMaterial,cockpit);
        rod([x+.032,.52,z-.035],[x+.032,.59,z-.035],.006,cautionMaterial,cockpit);
        rod([x-.032,.59,z-.035],[x+.032,.59,z-.035],.006,cautionMaterial,cockpit);
      }
    }
    const sill=mesh(new THREE.BoxGeometry(.085,.075,1.89),cockpitMetal,cockpit);sill.position.set(side*1.04,.59,-4.68);
  }
  const throttle=mesh(new THREE.BoxGeometry(.16,.10,.23),rubber,cockpit);throttle.position.set(-.85,.65,-4.42);
  rod([-.85,.52,-4.42],[-.85,.65,-4.42],.027,metal,cockpit);
  rod([0,.03,-4.79],[0,.35,-4.92],.041,cockpitMetal,cockpit);
  const stick=ellipsoid(rubber,0,.39,-4.95,.063,.13,.065,cockpit);
  const redSwitch=mesh(new THREE.CylinderGeometry(.014,.014,.012,10),navRed,cockpit);redSwitch.position.set(0,.514,-4.95);
  for(const side of [-1,1]) {
    const hudSupport=mesh(new THREE.BoxGeometry(.025,.21,.04),cockpitMetal,cockpit);hudSupport.position.set(side*.28,1.05,-6.01);hudSupport.rotation.x=-.13;
  }
  batchStaticMeshes(gearGroup);
  batchStaticMeshes(exterior,[gearGroup,...movingSurfaces.map(surface=>surface.pivot)]);
  batchStaticMeshes(cockpit);
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
    for(const surface of movingSurfaces) {
      const deflection=surface.kind==='flap'?(state.flaps ? .28 : 0):clamp((state.roll||0)*.13,-.16,.16)*surface.side;
      surface.pivot.quaternion.setFromAxisAngle(surface.axis,deflection*surface.side);
    }
    heat+=(Number(!!state.boosting)-heat)*.17;
    for(const flame of exhausts){flame.visible=heat>.015&&!state.crashed;flame.material.uniforms.time.value=time;flame.material.uniforms.power.value=heat;flame.scale.y=.95+Math.sin(time*34)*.035;}
    if(cockpit.visible)drawInstruments(state,time);
  }
  function setCockpit(enabled){exterior.visible=!enabled;cockpit.visible=enabled;root.visible=true;}
  return {root,update,setCockpit,cockpitViewPoint};
}
