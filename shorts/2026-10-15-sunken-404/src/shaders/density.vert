// The water's particles as splats, each drawn between its last two steps, so a fast drop or sheet
// keeps its shape between frames. Particles deeper than SPLAT_DEPTH under the volume line are
// dropped: the body there is drawn from the line, and the particles' surface above it needs only
// the particles within a kernel radius of it (most of the water would be filled and thrown away).
precision highp float;

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uAlpha;
uniform float uPointSize;

#include surface.glsl;

in vec2 position;
in vec2 prev;

out float vSpeed;

/** How far under the volume line a particle is still drawn (sim units): well past a kernel radius, and the foam's depth. */
const float SPLAT_DEPTH = 0.25;

void main() {
  vec2 p = mix(prev, position, uAlpha);
  if (p.y < surfaceAtX(p.x) - SPLAT_DEPTH) {
    // Outside the clip volume: dropped before rasterization.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vSpeed = 0.0;
    return;
  }
  // Speed in sim units per second, from the last step (60 Hz).
  vSpeed = length(position - prev) * 60.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
  gl_PointSize = uPointSize;
}
