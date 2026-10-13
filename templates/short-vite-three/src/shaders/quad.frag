uniform float uTime;
uniform vec2 uResolution;

in vec2 vUv;
out vec4 fragColor;

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float rings = 0.5 + 0.5 * cos(12.0 * length(p) - 1.5 * uTime);
  float falloff = smoothstep(0.9, 0.1, length(p));
  vec3 color = mix(vec3(0.02), vec3(0.9, 0.35, 0.2), rings * falloff);
  fragColor = vec4(color + 0.03 * vUv.y, 1.0);
}
