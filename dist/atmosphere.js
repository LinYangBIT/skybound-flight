// Original SKYBOUND atmosphere. The visible sky, filtered aircraft reflection
// and water all share this radiance function and the same sun direction.
export const atmosphereGLSL = `
uniform float time,coverage;
uniform vec3 topColor,horizonColor,sunColor,sunDirection,cloudTint;
vec3 atmosphere(vec3 direction, float disk) {
  vec3 d=normalize(direction);
  float up=max(d.y,0.0), sunDot=max(dot(d,sunDirection),0.0);
  vec3 sky=mix(horizonColor,topColor,pow(up,.42));
  sky+=sunColor*(pow(sunDot,16.0)*.065+pow(sunDot,160.0)*.14);
  vec2 uv=d.xz/max(d.y+.16,.07)*.83+vec2(time*.0015,0.0);
  float broad=fbm4(uv*.64);
  float cloudDensity=smoothstep(coverage,coverage+.15,broad);
  float lightEdge=smoothstep(.025,.13,fbm4(uv*.64+sunDirection.xz*.12)-broad+.06);
  vec3 cloud=cloudTint*(.73+lightEdge*.34)+sunColor*pow(sunDot,10.0)*.08;
  float cloudAlpha=cloudDensity*smoothstep(.015,.16,d.y)*.96;
  sky=mix(sky,cloud,cloudAlpha);
  sky+=sunColor*smoothstep(.99994,.999985,sunDot)*10.0*disk*(1.0-cloudAlpha);
  sky=mix(horizonColor,sky,smoothstep(-.03,.055,d.y));
  // The lower hemisphere contributes subdued ground bounce to the sky probe.
  return mix(horizonColor*.17,sky,smoothstep(-.32,.015,d.y));
}
`;
