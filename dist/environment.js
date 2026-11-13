import * as THREE from './vendor/three.module.js';
import { createTerrainSurface, sampleTerrainHeight } from './terrain-sampling.js?v=4';
import { atmosphereGLSL } from './atmosphere.js?v=4';
import { createAirport } from './airport.js?v=4';
import { createCoastalVegetation } from './coastal-vegetation.js?v=4';

// All terrain and material detail is deterministic and local: no imagery CDN.
const clamp = THREE.MathUtils.clamp;
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const fract = value => value - Math.floor(value);
function hash(x, z) { return fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453123); }
function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}
function fbm(x, z, octaves = 5) {
  let value = 0, amplitude = 0.5;
  for (let i = 0; i < octaves; i++) {
    value += noise(x, z) * amplitude;
    const nextX = x * 1.83 + z * 0.62 + 17.3;
    z = z * 1.83 - x * 0.62 + 7.9; x = nextX; amplitude *= 0.5;
  }
  return value;
}
const glslNoise = `
float hash21(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
 return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);}
float fbm4(vec2 p){float v=0.0,a=.5;mat2 m=mat2(1.64,-1.17,1.17,1.64);
 for(int i=0;i<4;i++){v+=a*n2(p);p=m*p+vec2(13.1,7.8);a*=.5;}return v;}
`;

export function createEnvironment(scene, renderer) {
  let seed = 103027;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const islands = [
    { x: 0, z: 0, rx: 900, rz: 1850, height: 230, main: true, phase: .3 },
    { x: -2450, z: -2800, rx: 1180, rz: 1050, height: 615, phase: 1.7 },
    { x: 2800, z: -3600, rx: 1200, rz: 1600, height: 740, phase: 3.1 },
    { x: -2950, z: 1700, rx: 750, rz: 980, height: 340, phase: 5.5 },
    { x: 3200, z: 2300, rx: 1250, rz: 1000, height: 480, phase: 4.4 },
    { x: -250, z: -6700, rx: 1580, rz: 900, height: 790, phase: 2.1 },
    { x: -1500, z: 4000, rx: 500, rz: 800, height: 250, phase: .8 },
    { x: -5900, z: -6400, rx: 1800, rz: 2300, height: 1150, phase: 6.8, distant: true },
    { x: 6300, z: -8100, rx: 2100, rz: 1650, height: 1080, phase: 8.2, distant: true },
    { x: 7100, z: 2400, rx: 1200, rz: 1950, height: 830, phase: 4.9, distant: true },
    { x: -6100, z: 6100, rx: 1700, rz: 1600, height: 820, phase: 9.4, distant: true },
    { x: 2800, z: 7600, rx: 1400, rz: 850, height: 560, phase: 7.1, distant: true },
  ];
  function coast(theta, island) {
    const a = theta + island.phase;
    return 1 + .10 * Math.sin(a * 3) + .07 * Math.sin(a * 7 + 1.9) + .025 * Math.sin(a * 17) + .014 * Math.sin(a * 31);
  }
  function localHeight(x, z, island) {
    const u = (x - island.x) / island.rx, v = (z - island.z) / island.rz;
    const r = Math.hypot(u, v) / coast(Math.atan2(v, u), island);
    if (r >= 1) return 0;
    const edge = smooth((1 - r) / .09);
    const wx = x * .0017 + island.phase * 11.2, wz = z * .0017 - island.phase * 4.9;
    const large = fbm(wx, wz, 4);
    const warp = fbm(wx * 1.6 + 22, wz * 1.6 + 83, 3);
    const ridge = 1 - Math.abs(2 * noise(wx * 2.4 + warp * 2.6, wz * 2.4 + warp * 1.9) - 1);
    const detail = fbm(x * .013 + 11, z * .013 + 63, 4) - .5;
    let h;
    if (island.main) {
      // Low, flat approach corridor; the side ridges have broken rocky spurs.
      const side = smooth((Math.abs(x) - 120) / 220);
      const spur = Math.pow(Math.max(0, 1 - r), .65) * (.3 + large * .6 + ridge * .34);
      h = 9 * edge + (island.height * spur + detail * 18) * side * edge;
      if (Math.abs(x) <= 110) h = Math.min(9, h);
      if (Math.abs(x) < 105 && Math.abs(z) < 1050) h = 9;
      const airportBlend = smooth((x - 55) / 40) * (1 - smooth((x - 325) / 220)) * smooth((z - 35) / 80) * (1 - smooth((z - 820) / 280));
      h = h * (1 - airportBlend) + 9 * airportBlend;
    } else {
      const mass = Math.pow(Math.max(0, 1 - r * r), 1.35);
      h = 8 * edge + island.height * mass * (.30 + .58 * large + .38 * ridge) + detail * 45 * mass;
      h *= edge;
    }
    return Math.max(0, h);
  }
  const terrainSurfaces = [];
  // Gameplay, terrain warnings and scenery placement all query the visible
  // triangles, not a fresh noise sample between the rendered vertices.
  const heightAt = (x, z) => sampleTerrainHeight(terrainSurfaces, x, z);

  const hemi = new THREE.HemisphereLight(0xbacfe5, 0x4c4a3c, .50);
  const sun = new THREE.DirectionalLight(0xfff2de, 2.7);
  const sunDirection = new THREE.Vector3(-.53, .57, -.63).normalize();
  sun.position.copy(sunDirection).multiplyScalar(1800);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {left:-380,right:380,top:380,bottom:-380,near:20,far:3900});
  sun.shadow.bias = -.000025; sun.shadow.normalBias = .10;
  const shadowRight = new THREE.Vector3(), shadowUp = new THREE.Vector3(), shadowCenter = new THREE.Vector3(), viewForward = new THREE.Vector3();
  scene.add(hemi, sun, sun.target);

  const skyUniforms = {
    time: {value:0}, topColor:{value:new THREE.Color('#536d89')}, horizonColor:{value:new THREE.Color('#b5c0c5')},
    sunColor:{value:new THREE.Color('#fff1d7')}, sunDirection:{value:sunDirection.clone()},
    coverage:{value:.52}, sunStrength:{value:3.15}, cloudTint:{value:new THREE.Color('#d9dfe0')},
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(24500, 32, 20), new THREE.ShaderMaterial({
    uniforms:skyUniforms,side:THREE.BackSide,depthWrite:false,fog:false,
    vertexShader:`varying vec3 skyDirection;void main(){skyDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`${glslNoise}${atmosphereGLSL}
      varying vec3 skyDirection;
      void main(){
        gl_FragColor=vec4(atmosphere(skyDirection,1.0),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -5; scene.add(sky);

  // Capture exactly the same sky radiance, in linear HDR, once per weather.
  // PMREM gives each metal/paint roughness the appropriate filtered reflection.
  // This is a distant sky probe, not a claim of scene-wide ray-traced GI.
  let reflectionTarget;
  const probeScene = new THREE.Scene();
  const probeSky = new THREE.Mesh(sky.geometry,sky.material);
  probeScene.add(probeSky);
  const pmrem = renderer ? new THREE.PMREMGenerator(renderer) : null;
  function refreshReflections(){
    if(!pmrem)return;
    const previousTime=skyUniforms.time.value;
    skyUniforms.time.value=18;
    const next=pmrem.fromScene(probeScene,0,.1,30000);
    skyUniforms.time.value=previousTime;
    scene.environment=next.texture;
    reflectionTarget?.dispose();reflectionTarget=next;
  }

  const waterUniforms = {
    ...skyUniforms,
    deepColor:{value:new THREE.Color('#143843')}, weatherRoughness:{value:1},
  };
  const waterGeometry = new THREE.PlaneGeometry(70000,70000,1,1);waterGeometry.rotateX(-Math.PI/2);
  const water = new THREE.Mesh(waterGeometry,new THREE.ShaderMaterial({
    uniforms:waterUniforms,
    vertexShader:`varying vec3 oceanWorld;void main(){oceanWorld=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(oceanWorld,1.0);}`,
    fragmentShader:`${glslNoise}${atmosphereGLSL}
      varying vec3 oceanWorld;uniform float weatherRoughness,sunStrength;uniform vec3 deepColor;
      void main(){
        vec3 eye=normalize(cameraPosition-oceanWorld);float dist=length(cameraPosition-oceanWorld);
        vec2 p=oceanWorld.xz;
        vec2 bend=vec2(n2(p*.012),n2(p*.012+vec2(53.0,29.0)));
        vec2 swell=p+(bend-.5)*32.0;
        // Analytic wave slopes avoid three expensive finite-difference FBM evaluations.
        vec2 slope=cos(dot(swell,vec2(.075,.027))-time*.78)*vec2(.075,.027)*.52;
        slope+=cos(dot(swell,vec2(-.046,.082))+time*.93)*vec2(-.046,.082)*.27;
        slope+=cos(dot(swell,vec2(.22,.16))-time*1.31)*vec2(.22,.16)*.018;
        float rippleFade=1.0-smoothstep(250.0,2400.0,dist);
        vec2 rip=p*.32+vec2(time*.17,-time*.12);
        float centre=n2(rip);
        slope+=vec2(n2(rip+vec2(.18,0.0))-centre,n2(rip+vec2(0.0,.18))-centre)*.25*rippleFade;
        float waveFade=1.0-smoothstep(4500.0,18000.0,dist);
        vec3 n=normalize(vec3(-slope.x*weatherRoughness*waveFade,1.0,-slope.y*weatherRoughness*waveFade));
        float nv=max(dot(n,eye),.001),f=.02+.98*pow(1.0-nv,5.0);
        vec3 reflected=atmosphere(reflect(-eye,n),0.0);
        float depthVariation=n2(p*.004)*.12;
        vec3 col=mix(deepColor*(.85+depthVariation),reflected,f);
        vec3 halfVector=normalize(eye+sunDirection);
        float nh=max(dot(n,halfVector),0.0), nl=max(dot(n,sunDirection),0.0);
        // Broaden distant highlights rather than aliasing thousands of tiny white points.
        float rough=.055*weatherRoughness+smoothstep(300.0,8500.0,dist)*.07;
        float a2=rough*rough, denom=nh*nh*(a2-1.0)+1.0;
        float distribution=a2/(3.14159*denom*denom);
        float fresnel=.025+.975*pow(1.0-max(dot(eye,halfVector),0.0),5.0);
        float visibility=1.0/(4.0*(nv+rough*(1.0-nv))*(nl+rough*(1.0-nl))+.001);
        col+=sunColor*distribution*fresnel*visibility*nl*.40*(sunStrength/3.15);
        float haze=1.0-exp(-dist*.000045);col=mix(col,horizonColor,haze*.56);
        gl_FragColor=vec4(col,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  water.position.y=-.25;scene.add(water);

  // Triplanar-like detail uses world space, so hills never stretch a flat texture.
  const terrainMaterial = new THREE.MeshStandardMaterial({color:0xffffff,roughness:.94,metalness:0,envMapIntensity:.36});
  terrainMaterial.onBeforeCompile = shader => {
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\nvarying vec3 terrainWorld;varying vec3 terrainNormal;`);
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\nterrainWorld=(modelMatrix*vec4(position,1.0)).xyz;terrainNormal=normalize(mat3(modelMatrix)*normal);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 terrainWorld;varying vec3 terrainNormal;${glslNoise}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec3 tw=terrainWorld;float slope=1.0-abs(normalize(terrainNormal).y);
      float broad=fbm4(tw.xz*.004);float middle=fbm4(tw.xz*.035+vec2(15.0,43.0));
      vec3 weights=pow(abs(normalize(terrainNormal)),vec3(4.0));weights/=max(dot(weights,vec3(1.0)),.001);
      float stone=dot(vec3(n2(tw.zy*.13),n2(tw.xz*.13),n2(tw.xy*.13)),weights);
      float fine=mix(n2(tw.xz*.46),.5,smoothstep(.3,1.4,length(fwidth(tw.xz*.46))));
      vec3 grass=mix(vec3(.066,.091,.053),vec3(.18,.205,.115),broad);
      vec3 woods=mix(vec3(.027,.046,.038),vec3(.085,.115,.079),middle);
      float forest=smoothstep(.39,.62,broad+middle*.12)*smoothstep(10.0,30.0,tw.y)*(1.0-smoothstep(.20,.45,slope));
      vec3 ground=mix(grass,woods,forest*.9);
      vec3 rock=mix(vec3(.13,.14,.138),vec3(.30,.295,.265),stone);
      float strata=sin(tw.y*.095+fbm4(tw.xz*.014)*9.0)*.035;rock*=.82+middle*.35+strata;
      float bare=smoothstep(.17,.51,slope)+smoothstep(520.0,1100.0,tw.y)*.45;
      ground=mix(ground,rock,clamp(bare,0.0,1.0));
      float beach=1.0-smoothstep(2.0,9.0,tw.y);vec3 sand=mix(vec3(.20,.19,.155),vec3(.34,.32,.265),middle);
      ground=mix(ground,sand,beach);ground*=.91+fine*.12+middle*.03;
      float damp=1.0-smoothstep(.2,2.0,tw.y);ground*=1.0-damp*.36;
      diffuseColor.rgb*=ground;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      vec3 blend=pow(abs(normalize(terrainNormal)),vec3(4.0));blend/=max(dot(blend,vec3(1.0)),.001);
      float surfaceDetail=dot(vec3(n2(terrainWorld.zy*.23),n2(terrainWorld.xz*.36),n2(terrainWorld.xy*.23)),blend);
      surfaceDetail=mix(surfaceDetail,.5,smoothstep(.3,1.5,length(fwidth(terrainWorld*.3))));
      vec3 sigmaX=dFdx(-vViewPosition),sigmaY=dFdy(-vViewPosition);
      vec3 r1=cross(sigmaY,normal),r2=cross(normal,sigmaX);float determinant=dot(sigmaX,r1);
      vec3 gradient=sign(determinant)*(dFdx(surfaceDetail)*r1+dFdy(surfaceDetail)*r2);
      normal=normalize(abs(determinant)*normal-gradient*mix(.055,.20,smoothstep(.12,.45,1.0-abs(normalize(terrainNormal).y))));`);
  };
  terrainMaterial.customProgramCacheKey=()=> 'skybound-real-terrain-v2';

  const shoreMaterial=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,side:THREE.DoubleSide,
    uniforms:{time:waterUniforms.time},
    vertexShader:`varying vec3 coastWorld;void main(){coastWorld=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`${glslNoise} varying vec3 coastWorld;uniform float time;void main(){float grain=fbm4(coastWorld.xz*.20+time*.09);float alpha=smoothstep(.40,.68,grain)*.22;gl_FragColor=vec4(.62,.68,.64,alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
  for(const island of islands){
    const nx=island.main?120:island.distant?60:94,nz=island.main?224:island.distant?66:104;
    const positions=new Float32Array((nx+1)*(nz+1)*3),uvs=new Float32Array((nx+1)*(nz+1)*2),indices=[];
    const width=island.rx*2.5,depth=island.rz*2.5;
    for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
      const index=iz*(nx+1)+ix,x=island.x+(ix/nx-.5)*width,z=island.z+(iz/nz-.5)*depth;
      const h=localHeight(x,z,island);positions.set([x,h>0?h:-2,z],index*3);uvs.set([ix/nx,iz/nz],index*2);
      if(ix<nx&&iz<nz){const a=index,b=a+nx+1;indices.push(a,b,a+1,a+1,b,b+1);}
    }
    terrainSurfaces.push(createTerrainSurface(positions,nx,nz));
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
    const terrain=new THREE.Mesh(geometry,terrainMaterial);terrain.receiveShadow=true;terrain.castShadow=true;scene.add(terrain);
    const foam=[],foamIndices=[],steps=256;
    for(let i=0;i<=steps;i++){
      const angle=i/steps*Math.PI*2,edge=coast(angle,island);
      for(const radius of [1.003,1.025])foam.push(island.x+Math.cos(angle)*island.rx*edge*radius,.08,island.z+Math.sin(angle)*island.rz*edge*radius);
      if(i<steps){const k=i*2;foamIndices.push(k,k+2,k+1,k+1,k+2,k+3);}
    }
    const foamGeometry=new THREE.BufferGeometry();foamGeometry.setAttribute('position',new THREE.Float32BufferAttribute(foam,3));foamGeometry.setIndex(foamIndices);scene.add(new THREE.Mesh(foamGeometry,shoreMaterial));
  }

  // Small, irregular rock outcrops break up near-field terrain without toy trees.
  const outcrops=[];
  for(let i=0;i<600;i++){
    const x=(random()-.5)*1800,z=(random()-.5)*3600,h=heightAt(x,z);
    if(h<15||Math.abs(x)<150||(x>60&&x<390&&z>0&&z<850))continue;
    outcrops.push({x,z,h,scale:1.5+random()*5});
  }
  const rockGeometry=new THREE.IcosahedronGeometry(1,1),rockPositions=rockGeometry.attributes.position;
  for(let i=0;i<rockPositions.count;i++){const f=.7+random()*.45;rockPositions.setXYZ(i,rockPositions.getX(i)*f,rockPositions.getY(i)*f*.7,rockPositions.getZ(i)*f);}rockGeometry.computeVertexNormals();
  const outcropMesh=new THREE.InstancedMesh(rockGeometry,new THREE.MeshStandardMaterial({color:0x626662,roughness:1}),outcrops.length);
  const dummy = new THREE.Object3D();
  outcrops.forEach((rock,index)=>{dummy.position.set(rock.x,rock.h,rock.z);dummy.scale.setScalar(rock.scale);dummy.rotation.set(random(),random()*6.28,0);dummy.updateMatrix();outcropMesh.setMatrixAt(index,dummy.matrix);});
  outcropMesh.castShadow=true;outcropMesh.receiveShadow=true;scene.add(outcropMesh);
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x343b40, roughness: 0.97 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x777c7c, roughness: 0.92 });
  const cream = new THREE.MeshStandardMaterial({ color: 0x8b8e89, roughness: 0.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x414a50, metalness: 0.35, roughness: 0.65 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x31444c, metalness: 0.5, roughness: 0.18 });
  function box(w, h, d, x, y, z, material, shadows = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z);
    mesh.castShadow = shadows; mesh.receiveShadow = true; scene.add(mesh); return mesh;
  }
  createAirport(scene,heightAt);
  createCoastalVegetation(scene,heightAt);

  const runwayCanvas = document.createElement('canvas'); runwayCanvas.width = 512; runwayCanvas.height = 4096;
  const ctx = runwayCanvas.getContext('2d');
  ctx.fillStyle = '#343839'; ctx.fillRect(0, 0, 512, 4096);
  for (let i = 0; i < 24000; i++) { ctx.fillStyle = `rgba(190,205,210,${random() * 0.035})`; ctx.fillRect(random() * 512, random() * 4096, 1, 1); }
  ctx.fillStyle = '#c9cac3'; ctx.fillRect(22, 25, 5, 4046); ctx.fillRect(485, 25, 5, 4046);
  for (let y = 270; y < 3850; y += 170) ctx.fillRect(250, y, 12, 82);
  for (const y of [40, 3956]) for (let i = 0; i < 10; i++) ctx.fillRect(55 + i * 41, y, 25, 100);
  for (const y of [670, 3230]) { ctx.fillRect(85, y, 54, 180); ctx.fillRect(373, y, 54, 180); }
  ctx.font = 'bold 136px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('36', 256, 3760); ctx.save(); ctx.translate(256, 325); ctx.rotate(Math.PI); ctx.fillText('18', 0, 0); ctx.restore();
  const runwayTexture = new THREE.CanvasTexture(runwayCanvas); runwayTexture.colorSpace = THREE.SRGBColorSpace; runwayTexture.anisotropy = 8;
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(90, 1800), new THREE.MeshStandardMaterial({ map: runwayTexture, roughness: 0.95 }));
  runway.rotation.x = -Math.PI / 2; runway.position.y = 9.11; runway.receiveShadow = true; scene.add(runway);

  const edgeCount = 62;
  const edgeLights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.6, 6, 4), new THREE.MeshBasicMaterial({ color: 0xb9efff }), edgeCount * 2);
  for (let i = 0; i < edgeCount; i++) for (let side = 0; side < 2; side++) {
    dummy.position.set(side ? 47 : -47, 9.8, -880 + i * 1760 / (edgeCount - 1)); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); edgeLights.setMatrixAt(i * 2 + side, dummy.matrix);
  }
  scene.add(edgeLights);
  const threshold = new THREE.InstancedMesh(new THREE.SphereGeometry(0.85, 6, 4), new THREE.MeshBasicMaterial({ color: 0x8dffc9 }), 20);
  for (let i = 0; i < 20; i++) { dummy.position.set(-39 + (i % 10) * 8.65, 9.8, i < 10 ? 905 : -905); dummy.updateMatrix(); threshold.setMatrixAt(i, dummy.matrix); } scene.add(threshold);

  // Windsock provides a small readable landmark beside the south threshold.
  box(0.7, 18, 0.7, -78, 18, 720, cream);
  const windsock = new THREE.Mesh(new THREE.ConeGeometry(2.3, 12, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xf8895a, side: THREE.DoubleSide }));
  windsock.rotation.z = -Math.PI / 2 - 0.12; windsock.position.set(-72, 26, 720); scene.add(windsock);


  // Skid marks and apron seams make the airport read at jet approach speed.
  const markCanvas=document.createElement('canvas');markCanvas.width=256;markCanvas.height=1024;
  const marks=markCanvas.getContext('2d');
  for(let i=0;i<450;i++){
    const x=75+random()*105,z=random()*1024;
    marks.strokeStyle=`rgba(14,17,18,${.015+random()*.055})`;marks.lineWidth=1+random()*3;
    marks.beginPath();marks.moveTo(x,z);marks.lineTo(x+(random()-.5)*3,z+30+random()*180);marks.stroke();
  }
  const markTexture=new THREE.CanvasTexture(markCanvas);
  const marksMaterial=new THREE.MeshBasicMaterial({map:markTexture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
  for(const z of [-610,610]){
    const skid=new THREE.Mesh(new THREE.PlaneGeometry(55,480),marksMaterial);skid.rotation.x=-Math.PI/2;skid.position.set(0,9.125,z);scene.add(skid);
  }
  let currentWeather;
  function setWeather(weather='clear'){
    const mode=typeof weather==='string'?weather:weather?.type||'clear';if(currentWeather===mode)return;currentWeather=mode;
    const settings={
      clear:{top:'#4e81b0',horizon:'#c4d1d8',fog:'#afc4cd',sun:'#fff1d9',water:'#163b46',cloud:'#e3e8e8',intensity:3.15,hemi:.50,elevation:.57,coverage:.53,near:5000,far:27000,rough:1.0},
      sunset:{top:'#5b6f8c',horizon:'#cfac91',fog:'#b5a799',sun:'#ffd0a0',water:'#243944',cloud:'#d7bfae',intensity:3.25,hemi:.38,elevation:.20,coverage:.53,near:4000,far:24000,rough:.85},
      cloudy:{top:'#718695',horizon:'#bdc7cb',fog:'#acbdc5',sun:'#e3ecf2',water:'#293e46',cloud:'#cdd4d7',intensity:.70,hemi:.82,elevation:.52,coverage:.31,near:3000,far:18000,rough:1.5},
    };
    const preset=settings[mode]||settings.clear;
    skyUniforms.topColor.value.set(preset.top);skyUniforms.horizonColor.value.set(preset.horizon);skyUniforms.sunColor.value.set(preset.sun);skyUniforms.cloudTint.value.set(preset.cloud);skyUniforms.coverage.value=preset.coverage;
    sunDirection.set(-.53,preset.elevation,-.63).normalize();skyUniforms.sunDirection.value.copy(sunDirection);
    waterUniforms.deepColor.value.set(preset.water);waterUniforms.weatherRoughness.value=preset.rough;
    sun.color.set(preset.sun);sun.intensity=preset.intensity;skyUniforms.sunStrength.value=preset.intensity;hemi.intensity=preset.hemi;sun.position.copy(sunDirection).multiplyScalar(1800);
    scene.fog=new THREE.Fog(preset.fog,preset.near,preset.far);scene.environmentIntensity=mode==='cloudy'?.95:.85;refreshReflections();
  }
  function update(time=0,weather,camera){
    skyUniforms.time.value=time;waterUniforms.time.value=time;
    windsock.rotation.z=-Math.PI/2-.12+Math.sin(time*2)*.025;
    if(camera){
      sky.position.copy(camera.position);water.position.x=Math.round(camera.position.x/1000)*1000;water.position.z=Math.round(camera.position.z/1000)*1000;
      // Stable local shadows: snap in the light's projection plane, one texel
      // at a time. The previous 120 m world jumps broke aircraft contact shadows.
      camera.getWorldDirection(viewForward);
      shadowCenter.copy(camera.position).addScaledVector(viewForward,80);
      shadowCenter.y=Math.max(0,camera.position.y*.48);
      shadowRight.set(sunDirection.z,0,-sunDirection.x).normalize();
      shadowUp.crossVectors(sunDirection,shadowRight).normalize();
      const texel=760/sun.shadow.mapSize.x;
      const sx=shadowCenter.dot(shadowRight),sy=shadowCenter.dot(shadowUp);
      shadowCenter.addScaledVector(shadowRight,Math.round(sx/texel)*texel-sx);
      shadowCenter.addScaledVector(shadowUp,Math.round(sy/texel)*texel-sy);
      sun.target.position.copy(shadowCenter);
      sun.position.copy(sunDirection).multiplyScalar(1800).add(shadowCenter);
      sun.target.updateMatrixWorld();
    }
    if(weather!==undefined)setWeather(weather);
  }
  setWeather('clear');
  return {update,setWeather,heightAt,islands};
}
