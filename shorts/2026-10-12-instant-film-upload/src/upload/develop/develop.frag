#version 300 es
precision highp float;

uniform sampler2D uImage;
uniform float uHasImage;
uniform float uDevelop;    // 0 is fresh from the camera, 1 is fully developed
uniform float uFog;        // the connection dropped: the image sinks back into the opacifier
uniform float uOverexpose; // too large to take: the frame blows out to white with a light leak
uniform float uDud;        // unsupported type: the reagent never spreads, the frame stays dark
uniform float uTime;
uniform float uSeed;
uniform vec2 uResolution;

in vec2 vUv;
out vec4 fragColor;

// Undeveloped integral film is a dark blue-green opacifier layer.
const vec3 OPACIFIER = vec3(0.105, 0.150, 0.160);
const vec3 SHADOW_TINT = vec3(0.090, 0.140, 0.165);
const vec3 PAPER_WHITE = vec3(0.975, 0.965, 0.935);

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amplitude * valueNoise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return sum;
}

void main() {
  vec2 uv = vUv;
  // Unpremultiplied texels: transparent areas of a cut-out photo develop onto paper, not black.
  vec4 texel = texture(uImage, vec2(uv.x, 1.0 - uv.y));
  vec3 image = uHasImage > 0.5 ? mix(PAPER_WHITE, texel.rgb, texel.a) : PAPER_WHITE;
  float t = clamp(uDevelop, 0.0, 1.0);

  // The reagent spreads from the pod at the bottom edge, unevenly, and the borders clear last.
  float border = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float edgeLag = 1.0 - smoothstep(0.0, 0.16, border);
  float mottle = fbm(uv * 3.2 + uSeed * 17.0) - 0.5;
  float front = t * 1.3 - 0.15 + mottle * 0.32 - edgeLag * 0.14 + (0.5 - uv.y) * 0.06;
  float cleared = smoothstep(0.0, 0.42, front) * (1.0 - uFog * 0.82);

  // Early develop is cyan, flat and lifted. Contrast, saturation and warmth arrive last.
  float luma = dot(image, vec3(0.2126, 0.7152, 0.0722));
  float saturation = mix(0.12, 1.0, smoothstep(0.18, 0.96, t)) * (1.0 - uFog * 0.6);
  vec3 graded = mix(vec3(luma), image, saturation);
  graded = (graded - 0.5) * mix(0.42, 1.06, smoothstep(0.08, 1.0, t)) + 0.5;
  graded *= mix(vec3(0.74, 0.92, 1.04), vec3(1.03, 1.0, 0.955), smoothstep(0.22, 0.97, t));
  graded = mix(SHADOW_TINT, vec3(1.0), clamp(graded, 0.0, 1.0)) * mix(0.82, 1.0, t) + SHADOW_TINT * mix(0.35, 0.0, t);

  vec3 color = mix(OPACIFIER, graded, cleared);

  // Unsupported type: a dud print, dark with a bruise of unspread reagent along the pod edge.
  float bruise = smoothstep(0.62, 0.0, uv.y + fbm(uv * vec2(6.0, 2.0) + uSeed) * 0.35);
  color = mix(color, mix(OPACIFIER * 0.85, vec3(0.32, 0.27, 0.16), bruise * 0.7), uDud);

  // Too large: blown out to paper white with a warm light leak from the top left.
  float leak = smoothstep(0.95, 0.0, distance(uv, vec2(-0.08, 1.08)) - mottle * 0.25);
  vec3 blown = mix(PAPER_WHITE, vec3(0.99, 0.62, 0.38), leak * 0.65);
  color = mix(color, blown, uOverexpose);

  // Grain is coarser while the image is still developing, then settles.
  float grain = hash(uv * uResolution + fract(uTime * 7.3) * 91.0) - 0.5;
  color += grain * mix(0.07, 0.022, t);

  // Gentle falloff toward the corners, like the lens of an instant camera.
  float vignette = smoothstep(0.98, 0.32, length(uv - 0.5));
  color *= mix(0.84, 1.0, vignette);

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
