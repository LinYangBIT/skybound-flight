import * as THREE from './vendor/three.module.js';

// Optical treatment stays subtle: peripheral motion blur, film grain and highlight roll-off.
export function createCameraEffects(renderer) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false });
  target.samples = innerWidth > 760 ? 2 : 0;
  const material = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { frame: {value: target.texture}, motion: {value: 0}, time: {value: 0}, aspect: {value: 1} },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `uniform sampler2D frame; uniform float motion,time,aspect; varying vec2 vUv;
      float grain(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
      void main(){
        vec2 radial=vUv-vec2(.5); float edge=smoothstep(.14,.7,length(radial));
        vec2 stepUV=radial*motion*edge*.005;
        vec3 color=texture2D(frame,vUv).rgb*.4;
        color+=texture2D(frame,vUv+stepUV).rgb*.15;
        color+=texture2D(frame,vUv-stepUV).rgb*.15;
        color+=texture2D(frame,vUv+stepUV*2.).rgb*.1;
        color+=texture2D(frame,vUv-stepUV*2.).rgb*.1;
        color+=texture2D(frame,vUv+stepUV*3.).rgb*.05;
        color+=texture2D(frame,vUv-stepUV*3.).rgb*.05;
        float vignette=1.-.14*dot(radial,radial)*2.;
        color*=vignette;
        color+=vec3((grain(gl_FragCoord.xy+fract(time)*100.)-.5)*.004);
        gl_FragColor=vec4(max(color,0.),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const scene = new THREE.Scene(), camera = new THREE.Camera();
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);screen.frustumCulled=false;scene.add(screen);
  function resize(width, height) {const pixel=renderer.getPixelRatio();target.setSize(Math.max(1,Math.floor(width*pixel)),Math.max(1,Math.floor(height*pixel)));material.uniforms.aspect.value=width/height;}
  let quality = 'high';
  function setQuality(value) {quality=value;const samples=value==='low'?0:2;if(target.samples!==samples){target.dispose();target.samples=samples;}}
  function render(world, view, state, time, active) {
    if(quality==='low'){renderer.setRenderTarget(null);renderer.render(world,view);return;}
    material.uniforms.motion.value=active?THREE.MathUtils.clamp((state.speed-160)/240,0,1)*(state.boosting?1:.4):0;
    material.uniforms.time.value=time;
    renderer.setRenderTarget(target);renderer.render(world,view);renderer.setRenderTarget(null);renderer.render(scene,camera);
  }
  resize(innerWidth,innerHeight);
  return {render,resize,setQuality};
}
