import * as THREE from './vendor/three.module.js';
import { createTerrainSurface, sampleTerrainHeight } from './terrain-sampling.js?v=3';

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

export function createEnvironment(scene) {
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
      h = 9 * edge + (island.height * spur + detail * 42) * side * edge;
      if (Math.abs(x) <= 110) h = Math.min(9, h);
      if (Math.abs(x) < 105 && Math.abs(z) < 1050) h = 9;
      const airportBlend = smooth((x - 55) / 40) * (1 - smooth((x - 325) / 70)) * smooth((z - 35) / 45) * (1 - smooth((z - 800) / 60));
      h = h * (1 - airportBlend) + 9 * airportBlend;
    } else {
      const mass = Math.pow(Math.max(0, 1 - r * r), 1.35);
      h = 8 * edge + island.height * mass * (.30 + .58 * large + .38 * ridge) + detail * 75 * mass;
      h *= edge;
    }
    return Math.max(0, h);
  }
  const terrainSurfaces = [];
  // Gameplay, terrain warnings and scenery placement all query the visible
  // triangles, not a fresh noise sample between the rendered vertices.
  const heightAt = (x, z) => sampleTerrainHeight(terrainSurfaces, x, z);

  const hemi = new THREE.HemisphereLight(0xbac9d6, 0x31352e, 1.15);
  const sun = new THREE.DirectionalLight(0xfff2de, 2.7);
  const sunDirection = new THREE.Vector3(-.53, .57, -.63).normalize();
  sun.position.copy(sunDirection).multiplyScalar(6500);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {left:-1300,right:1300,top:1300,bottom:-1300,near:100,far:14000});
  sun.shadow.bias = -.00012; sun.shadow.normalBias = .45;
  scene.add(hemi, sun, sun.target);

  const skyUniforms = {
    time: {value:0}, topColor:{value:new THREE.Color('#536d89')}, horizonColor:{value:new THREE.Color('#b5c0c5')},
    sunColor:{value:new THREE.Color('#fff1d7')}, sunDirection:{value:sunDirection.clone()},
    coverage:{value:.52}, cloudTint:{value:new THREE.Color('#d9dfe0')},
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(24500, 32, 20), new THREE.ShaderMaterial({
    uniforms:skyUniforms,side:THREE.BackSide,depthWrite:false,fog:false,
    vertexShader:`varying vec3 skyDirection;void main(){skyDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`${glslNoise}
      varying vec3 skyDirection;uniform float time,coverage;uniform vec3 topColor,horizonColor,sunColor,sunDirection,cloudTint;
      void main(){
        vec3 d=normalize(skyDirection); float up=max(d.y,0.0);float sunDot=max(dot(d,sunDirection),0.0);
        vec3 col=mix(horizonColor,topColor,pow(up,.48));
        col+=sunColor*(pow(sunDot,18.0)*.045+pow(sunDot,480.0)*.32+smoothstep(.99993,.999985,sunDot)*5.0);
        vec2 uv=d.xz/max(d.y+.09,.055)*1.15+vec2(time*.002,0.0);
        float broad=fbm4(uv*.55);float fine=fbm4(uv*2.4+vec2(73.0,13.0));
        float layer=smoothstep(coverage,coverage+.17,broad*.80+fine*.20);
        float shade=fbm4(uv*.55+vec2(.08,.1));
        vec3 cloud=cloudTint*(.73+.42*shade)+sunColor*pow(sunDot,11.0)*.12;
        float visible=smoothstep(-.01,.08,d.y);col=mix(col,cloud,layer*visible*.93);
        float cirrus=smoothstep(.51,.72,fbm4(uv*vec2(.42,2.1)+vec2(130.0,42.0)))*.13*visible;
        col=mix(col,cloudTint,cirrus);col=mix(horizonColor,col,smoothstep(-.04,.065,d.y));
        gl_FragColor=vec4(col,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -5; scene.add(sky);

  // A local equirectangular sky provides real environment reflections on the jet.
  const reflectionCanvas = document.createElement('canvas'); reflectionCanvas.width=1024; reflectionCanvas.height=512;
  const reflectionContext = reflectionCanvas.getContext('2d');
  const reflection = new THREE.CanvasTexture(reflectionCanvas);reflection.mapping=THREE.EquirectangularReflectionMapping;reflection.colorSpace=THREE.SRGBColorSpace;
  scene.environment=reflection;scene.environmentIntensity=.65;
  function refreshReflections(top,horizon){
    const gradient=reflectionContext.createLinearGradient(0,0,0,512);
    gradient.addColorStop(0,top);gradient.addColorStop(.46,horizon);gradient.addColorStop(.54,'#6e7b7e');gradient.addColorStop(1,'#273334');
    reflectionContext.fillStyle=gradient;reflectionContext.fillRect(0,0,1024,512);
    const sunGlow=reflectionContext.createRadialGradient(224,150,2,224,150,34);sunGlow.addColorStop(0,'rgba(255,249,226,.95)');sunGlow.addColorStop(.3,'rgba(255,249,226,.3)');sunGlow.addColorStop(1,'rgba(255,249,226,0)');reflectionContext.fillStyle=sunGlow;reflectionContext.fillRect(180,105,88,88);
    reflection.needsUpdate=true;
  }

  const waterUniforms = {
    time:{value:0},deepColor:{value:new THREE.Color('#123340')},horizonColor:{value:new THREE.Color('#a6b6c1')},
    topColor:{value:new THREE.Color('#536d89')},sunDirection:{value:sunDirection.clone()},sunTint:{value:new THREE.Color('#fff1d7')},
    weatherRoughness:{value:1},
  };
  const waterGeometry = new THREE.PlaneGeometry(70000,70000,1,1);waterGeometry.rotateX(-Math.PI/2);
  const water = new THREE.Mesh(waterGeometry,new THREE.ShaderMaterial({
    uniforms:waterUniforms,
    vertexShader:`varying vec3 oceanWorld;void main(){oceanWorld=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(oceanWorld,1.0);}`,
    fragmentShader:`${glslNoise}
      varying vec3 oceanWorld;uniform float time,weatherRoughness;uniform vec3 deepColor,horizonColor,topColor,sunDirection,sunTint;
      float waves(vec2 p){
        vec2 flow=vec2(time*.82,time*.29);float h=fbm4(p*.092+flow*.22)*.8;
        h+=sin(dot(p,vec2(.038,.021))+time*.64)*.42;
        h+=sin(dot(p,vec2(-.057,.039))-time*.82)*.19;
        h+=sin(dot(p,vec2(.131,.073))+time*1.27)*.055;
        return h;
      }
      void main(){
        vec3 eye=normalize(cameraPosition-oceanWorld);float dist=length(cameraPosition-oceanWorld);
        vec2 p=oceanWorld.xz;float base=waves(p),hx=waves(p+vec2(.5,0.0)),hz=waves(p+vec2(0.0,.5));
        float detailFade=1.0-smoothstep(6000.0,16000.0,dist);
        vec3 n=normalize(vec3((base-hx)*2.2*weatherRoughness*detailFade,1.0,(base-hz)*2.2*weatherRoughness*detailFade));
        float f=.035+.965*pow(1.0-max(dot(n,eye),0.0),5.0);
        vec3 r=reflect(-eye,n);vec3 sky=mix(horizonColor,topColor,pow(max(r.y,0.0),.50));
        float wavePattern=fbm4(p*.006+vec2(time*.025));
        vec3 under=deepColor*(.77+wavePattern*.45);vec3 col=mix(under,sky,f*.9);
        vec3 halfVector=normalize(eye+sunDirection);float ndh=max(dot(n,halfVector),0.0);
        float glint=pow(ndh,950.0)*4.0+pow(ndh,140.0)*.18;
        col+=sunTint*glint*detailFade;
        float cap=smoothstep(.77,.90,fbm4(p*.105+vec2(time*.14,time*.08)))*smoothstep(.35,.9,base)*.22;
        col=mix(col,vec3(.65,.70,.70),cap*detailFade);
        float haze=1.0-exp(-dist*.000055);col=mix(col,horizonColor,haze*.70);
        gl_FragColor=vec4(col,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  water.position.y=-.25;scene.add(water);

  // Triplanar-like detail uses world space, so hills never stretch a flat texture.
  const terrainMaterial = new THREE.MeshStandardMaterial({color:0xffffff,roughness:.96,metalness:0,envMapIntensity:.16});
  terrainMaterial.onBeforeCompile = shader => {
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\nvarying vec3 terrainWorld;varying vec3 terrainNormal;`);
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\nterrainWorld=(modelMatrix*vec4(position,1.0)).xyz;terrainNormal=normalize(mat3(modelMatrix)*normal);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 terrainWorld;varying vec3 terrainNormal;${glslNoise}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec3 tw=terrainWorld;float slope=1.0-abs(normalize(terrainNormal).y);
      float broad=fbm4(tw.xz*.004);float middle=fbm4(tw.xz*.035+vec2(15.0,43.0));
      float fine=fbm4(tw.xz*.46);float stone=fbm4(tw.xy*.13)+fbm4(tw.zy*.13);
      vec3 grass=mix(vec3(.075,.095,.066),vec3(.18,.19,.125),broad);
      vec3 woods=mix(vec3(.027,.046,.038),vec3(.085,.115,.079),middle);
      float forest=smoothstep(.39,.62,broad+middle*.12)*smoothstep(10.0,30.0,tw.y)*(1.0-smoothstep(.20,.45,slope));
      vec3 ground=mix(grass,woods,forest*.9);
      vec3 rock=mix(vec3(.105,.112,.111),vec3(.27,.265,.245),stone*.45);
      float strata=sin(tw.y*.095+fbm4(tw.xz*.014)*9.0)*.035;rock*=.82+middle*.35+strata;
      float bare=smoothstep(.17,.51,slope)+smoothstep(520.0,1100.0,tw.y)*.45;
      ground=mix(ground,rock,clamp(bare,0.0,1.0));
      float beach=1.0-smoothstep(2.0,9.0,tw.y);vec3 sand=mix(vec3(.20,.19,.155),vec3(.34,.32,.265),middle);
      ground=mix(ground,sand,beach);ground*=.76+fine*.43+middle*.13;
      float damp=1.0-smoothstep(.2,2.0,tw.y);ground*=1.0-damp*.36;
      diffuseColor.rgb*=ground;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      float surfaceDetail=fbm4(terrainWorld.xz*.36)+fbm4(terrainWorld.xy*.23)*.3;
      vec3 sigmaX=dFdx(-vViewPosition),sigmaY=dFdy(-vViewPosition);
      vec3 r1=cross(sigmaY,normal),r2=cross(normal,sigmaX);float determinant=dot(sigmaX,r1);
      vec3 gradient=sign(determinant)*(dFdx(surfaceDetail)*r1+dFdy(surfaceDetail)*r2);
      normal=normalize(abs(determinant)*normal-gradient*.48);`);
  };
  terrainMaterial.customProgramCacheKey=()=> 'skybound-real-terrain-v2';

  const shoreMaterial=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,side:THREE.DoubleSide,
    uniforms:{time:waterUniforms.time},
    vertexShader:`varying vec3 coastWorld;void main(){coastWorld=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`${glslNoise} varying vec3 coastWorld;uniform float time;void main(){float grain=fbm4(coastWorld.xz*.20+time*.09);float alpha=smoothstep(.40,.68,grain)*.22;gl_FragColor=vec4(.62,.68,.64,alpha);}`,
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
  box(190, 0.12, 580, 185, 9, 430, concrete, false);
  box(65, 0.13, 90, 72, 9.02, 400, asphalt, false);

  const runwayCanvas = document.createElement('canvas'); runwayCanvas.width = 512; runwayCanvas.height = 4096;
  const ctx = runwayCanvas.getContext('2d');
  ctx.fillStyle = '#343839'; ctx.fillRect(0, 0, 512, 4096);
  for (let i = 0; i < 24000; i++) { ctx.fillStyle = `rgba(190,205,210,${random() * 0.12})`; ctx.fillRect(random() * 512, random() * 4096, random() * 4 + 1, random() * 7 + 1); }
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

  for (let i = 0; i < 3; i++) {
    const z = 310 + i * 130;
    box(78, 27, 90, 250, 22.5, z, cream);
    box(84, 4, 97, 250, 38, z, roofMat);
    box(1, 20, 66, 210.5, 19.5, z, asphalt);
    box(2, 2, 64, 209.5, 31, z, glass);
  }
  box(16, 38, 16, 175, 28, 160, cream);
  box(29, 10, 26, 175, 49, 160, glass);
  box(33, 2, 30, 175, 55, 160, roofMat);
  box(1, 18, 1, 175, 65, 160, cream);
  box(55, 11, 30, 238, 14.5, 180, cream);
  box(59, 2, 34, 238, 21, 180, roofMat);

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
      clear:{top:'#506c8b',horizon:'#b8c2c7',fog:'#a9b8c0',sun:'#fff2df',water:'#153a46',cloud:'#d9dedf',intensity:2.7,hemi:1.18,elevation:.57,coverage:.48,near:4500,far:24500,rough:1.0},
      sunset:{top:'#555f77',horizon:'#c6b0a0',fog:'#a99e98',sun:'#ffd5a7',water:'#293a44',cloud:'#c7b8ae',intensity:2.3,hemi:.95,elevation:.20,coverage:.51,near:4000,far:22000,rough:.90},
      cloudy:{top:'#74838d',horizon:'#b8c1c3',fog:'#a8b5bb',sun:'#dfe9f0',water:'#263c45',cloud:'#bfc6c7',intensity:.85,hemi:1.55,elevation:.52,coverage:.34,near:3000,far:18000,rough:1.35},
    };
    const preset=settings[mode]||settings.clear;
    skyUniforms.topColor.value.set(preset.top);skyUniforms.horizonColor.value.set(preset.horizon);skyUniforms.sunColor.value.set(preset.sun);skyUniforms.cloudTint.value.set(preset.cloud);skyUniforms.coverage.value=preset.coverage;
    sunDirection.set(-.53,preset.elevation,-.63).normalize();skyUniforms.sunDirection.value.copy(sunDirection);
    waterUniforms.deepColor.value.set(preset.water);waterUniforms.horizonColor.value.set(preset.horizon);waterUniforms.topColor.value.set(preset.top);waterUniforms.sunTint.value.set(preset.sun);waterUniforms.sunDirection.value.copy(sunDirection);waterUniforms.weatherRoughness.value=preset.rough;
    sun.color.set(preset.sun);sun.intensity=preset.intensity;hemi.intensity=preset.hemi;sun.position.copy(sunDirection).multiplyScalar(6500);
    scene.fog=new THREE.Fog(preset.fog,preset.near,preset.far);refreshReflections(preset.top,preset.horizon);
  }
  function update(time=0,weather,camera){
    skyUniforms.time.value=time;waterUniforms.time.value=time;
    windsock.rotation.z=-Math.PI/2-.12+Math.sin(time*2)*.025;
    if(camera){
      sky.position.copy(camera.position);water.position.x=Math.round(camera.position.x/1000)*1000;water.position.z=Math.round(camera.position.z/1000)*1000;
      // Restrict frequent updates to a local shadow patch; the airport stays crisp.
      const x=Math.round(camera.position.x/120)*120,z=Math.round(camera.position.z/120)*120;
      sun.target.position.set(x,0,z);sun.position.copy(sunDirection).multiplyScalar(6500).add(sun.target.position);sun.target.updateMatrixWorld();
    }
    if(weather!==undefined)setWeather(weather);
  }
  setWeather('clear');
  return {update,setWeather,heightAt,islands};
}
