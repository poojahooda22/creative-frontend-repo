// The sand bed: fine grain, a slow mottle, scattered grit, lit by the key light. The water's light
// loss and the caustics are added by the composite, as for everything else in the tank; the sand
// stays bright like the creatures on it (VIVID).
uniform vec3 uLightDir;
uniform vec3 uKey;
uniform vec3 uAmbient;

in vec3 vWorld;
in vec3 vNormal;
out vec4 fragColor;

#include common.glsl;
#include surface.glsl;
#include water.glsl;

void main() {
  vec3 n = normalize(vNormal);
  // Pattern coordinates in the face's own plane: x and z on the top, x and y on the front face,
  // which the camera sees edge-on (x and z there would smear into vertical streaks).
  vec2 q = abs(n.z) > 0.7 ? vWorld.xy * vec2(1.0, 3.0) : vWorld.xz;
  float grain = hash12(floor(q * 520.0)) * 0.5 + hash12(floor(q * 1300.0)) * 0.5;
  float mottle = fbm(q * vec2(2.2, 3.4));
  vec3 light = srgb(vec3(0.76, 0.68, 0.48));
  vec3 dark = srgb(vec3(0.46, 0.4, 0.27));
  vec3 albedo = mix(dark, light, 0.3 + 0.55 * mottle);
  albedo *= 0.82 + 0.36 * grain;
  // Darker grit specks.
  vec2 cell = floor(q * 40.0);
  vec2 f = fract(q * 40.0) - 0.5;
  float speck = (1.0 - smoothstep(0.12, 0.3, length(f))) * step(0.86, hash12(cell + 5.0));
  albedo *= 1.0 - 0.45 * speck;

  // Lambert from the key light, plus the ambient the environment gives the other materials.
  float key = max(dot(n, uLightDir), 0.0);
  vec3 color = albedo * (uKey * key + uAmbient) / 3.14159265;
  color *= exp(LIGHT_LOSS * VIVID * max(surfaceAtX(vWorld.x) - vWorld.y, 0.0));
  fragColor = vec4(color, 1.0);
}
