// The final image: the page backdrop, everything in the tank seen through the water, the water
// itself (light lost by depth and by distance through the tank, caustics, shafts, the meniscus),
// then highlight compression.
uniform sampler2D tScene;
uniform sampler2D tDepth;
// The particles' splats (see density.frag): kernel sum, kernel-weighted offset (x, y), and speed.
uniform sampler2D tDensity;
// Light from the bubbles (red channel), drawn after the tank with their own depth test.
uniform sampler2D tBubbles;
uniform vec2 uResolution;
// The view in sim units: its size, and where its left edge sits (0 unless the window was just
// resized and the tank has not been rebuilt for the new shape yet).
uniform vec2 uSim;
uniform float uOrigin;
uniform float uPixelRatio;
uniform float uTime;
uniform float uDensityScale;
uniform vec2 uSpot;
// Down the spotlight's beam, from its source above the top edge (see SPOT_TILT in scene.ts).
uniform vec2 uSpotAxis;
uniform float uExposure;
// The camera, to put each pixel's depth back in the tank: position, tan of the half field of
// view (x, y) and the near and far planes.
uniform vec3 uCamera;
uniform vec2 uTanHalf;
uniform vec2 uClip;
// The tank's front glass, and how far back open water reaches where nothing was drawn.
uniform float uGlassZ;
uniform float uBackZ;
// Toward the key light.
uniform vec3 uLightDir;
// 0 until the tank is ready to draw, then easing to 1: the water and everything in it fade in.
uniform float uReveal;
// The particles' surface (see SPLAT_RADIUS in world.ts), sim units: the kernel radius, the radius
// a lone particle draws at, and the width of the union that joins it to the body.
uniform float uSplatRadius;
uniform float uDropRadius;
uniform float uUnionSmooth;
// 1 draws the water's fill, meniscus and band as red, green and blue, for inspection (?view=mask).
uniform float uView;

in vec2 vUv;
out vec4 fragColor;

#include common.glsl;
#include surface.glsl;
#include water.glsl;

// The water's own colour (light scattered back to the viewer), just under the surface and deep.
const vec3 WATER_TOP = vec3(0.034, 0.1, 0.108);
const vec3 WATER_DEEP = vec3(0.005, 0.017, 0.02);

// A soft cone of light from above the top edge, widening as it falls.
float spot(vec2 p) {
  vec2 rel = p - uSpot;
  float along = max(dot(rel, uSpotAxis), 0.0);
  float across = dot(rel, vec2(-uSpotAxis.y, uSpotAxis.x));
  float width = 0.22 + 0.2 * along;
  return exp(-(across * across) / (width * width)) / (1.0 + 0.18 * along);
}

// The page: warm near-black, a faint dot grid, the spotlight.
vec3 page(vec2 p) {
  vec3 base = srgb(vec3(0.087, 0.08, 0.072));
  vec3 col = base + srgb(vec3(0.42, 0.38, 0.33)) * 0.14 * spot(p);
  // Dots every 28 CSS px.
  vec2 css = gl_FragCoord.xy / uPixelRatio;
  vec2 cell = mod(css, 28.0) - 14.0;
  float grid = 1.0 - smoothstep(0.55, 1.25, length(cell));
  col += vec3(0.0045) * grid;
  // A slow vignette toward the corners.
  vec2 v = vUv - 0.5;
  col *= 1.0 - 0.35 * dot(v, v);
  return col;
}

// Light shafts under water: bright lines along the spotlight's axis, wandering slowly.
float shafts(vec2 p, float depth) {
  vec2 perp = vec2(-uSpotAxis.y, uSpotAxis.x);
  float across = dot(p - uSpot, perp);
  float n = 0.62 * valueNoise(vec2(across * 9.0, uTime * 0.22)) + 0.38 * valueNoise(vec2(across * 23.0 + 4.1, uTime * 0.37));
  float beams = smoothstep(0.42, 0.92, n);
  return beams * spot(p) * exp(-depth * 1.15) * smoothstep(0.0, 0.06, depth);
}

// The water seen with nothing in front of it: brightest near the top and inside the spotlight.
vec3 waterColor(vec2 p, float depth) {
  float s = min(1.0, spot(p) * 1.6);
  float w = exp(-2.2 * depth);
  return mix(WATER_DEEP * (0.45 + 0.9 * s), WATER_TOP * (0.85 + 0.35 * s), w);
}

// The point in the tank the camera sees at uv, from the drawn scene's depth. An edge pixel whose
// depth sample missed the surface falls back to the back of the open water.
vec3 seenPoint(vec2 uv, float depth) {
  float dist = depth < 1.0 ? (uClip.x * uClip.y) / (uClip.y - (uClip.y - uClip.x) * depth) : uCamera.z - uBackZ;
  return vec3(uCamera.xy + (uv * 2.0 - 1.0) * uTanHalf * dist, uCamera.z - dist);
}

// Highlight compression from Khronos PBR Neutral, without its toe: the toe subtracts the darkest
// channel from dark colours, which would push this dim teal water to pure green.
vec3 compressHighlights(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// The water's shape as one signed distance (sim units, negative inside), so the fill and the
// meniscus drawn on its zero line cannot part, whatever the water does. Below the volume line S
// is the body: the distance to that line along its normal. Above it the water is what the
// particles say: Zhu and Bridson's surface (SIGGRAPH 2005, section 5), the distance to the
// kernel-weighted mean of the particles within uSplatRadius less a particle's radius, so a drop
// is a disc, a sheet a strip, and a pocket of air trapped in a slosh a hole. A smooth union
// (Quilez's polynomial smooth minimum) joins the two where a crest or a sheet rises out of the
// body; its gradient is the same blend of theirs, which gives the edge's outward normal.
// Still particles near the line are drawn sunk under it (World.drawnParticles), so there the union
// is the line exactly.
float waterField(vec2 p, float S, float slope, vec4 splat, out vec2 normal) {
  float cosine = inversesqrt(1.0 + slope * slope);
  float body = (p.y - S) * cosine;
  vec2 bodyNormal = vec2(-slope, 1.0) * cosine;
  float spread = length(splat.gb);
  // Past every particle's reach the surface reads as it does at the edge of one particle's reach, so the
  // field has no step there for the edge's gradient to catch.
  float particles = splat.r > 1e-4 ? spread / splat.r * uSplatRadius - uDropRadius : uSplatRadius - uDropRadius;
  vec2 particleNormal = spread > 1e-6 ? splat.gb / spread : bodyNormal;
  float k = uUnionSmooth;
  float h = clamp(0.5 + 0.5 * (body - particles) / k, 0.0, 1.0);
  vec2 n = mix(bodyNormal, particleNormal, h);
  normal = dot(n, n) > 1e-8 ? normalize(n) : vec2(0.0, 1.0);
  return mix(body, particles, h) - k * h * (1.0 - h);
}

// How much water lies above a point, for its colour and its light. Below the volume line, its
// depth under the line plus the water held above the line (a crest, a slab over a pocket of air);
// above the line, down from the top of the water there, never more than the water held. The two
// meet at the line (the top is never below the line plus the water held), so the shade is
// continuous through every shape the water takes.
float waterAbove(vec2 q, float S) {
  float A = aboveAtX(q.x);
  float T = max(topAtX(q.x), S + A);
  return q.y < S ? S - q.y + A : clamp(T - q.y, 0.0, A);
}

void main() {
  vec2 uv = vUv;
  vec2 p = vec2(uOrigin, 0.0) + uv * uSim;
  float pxSim = uSim.y / uResolution.y;

  float e = uCell;
  float S = surfaceAtX(p.x);
  float slope = (surfaceAtX(p.x + e) - surfaceAtX(p.x - e)) / (2.0 * e);
  vec4 splat = texture(tDensity, uv);
  vec2 n;
  float phi = waterField(p, S, slope, splat, n);
  // The field is a distance only where its gradient is one. In the smooth union and in the particles'
  // concave corners it is shallower, which drew the meniscus wide and left faint streaks where the field
  // nearly reached the water. Measured against its own gradient, per pixel, the edge and its meniscus
  // keep one width everywhere (device pixels, negative inside).
  float edge = phi / max(length(vec2(dFdx(phi), dFdy(phi))), 1e-6 * pxSim);
  float reveal = smoothstep(0.0, 1.0, uReveal);
  float water = (1.0 - smoothstep(-1.0, 1.0, edge)) * reveal;
  float d = waterAbove(p, S);
  float density = splat.r * uDensityScale;
  float speed = splat.a / max(splat.r, 1e-3);

  // Refraction: the surface slope bends the view near the top, small ripples everywhere.
  float t = uTime;
  vec2 ripple = vec2(valueNoise(p * 7.0 + vec2(t * 0.55, 0.0)), valueNoise(p * 7.0 + vec2(3.7, t * 0.45))) - 0.5;
  float nearTop = exp(-d * 5.0);
  vec2 bend = (vec2(-slope * 0.018, 0.0) * nearTop + ripple * 0.004) * water;
  vec2 uvR = clamp(uv + bend / uSim, vec2(0.0), vec2(1.0));
  vec4 scene = texture(tScene, uvR);
  vec3 dry = page(vec2(uOrigin, 0.0) + uvR * uSim) * (1.0 - scene.a * reveal) + scene.rgb * reveal;

  // Under water. Sunlight reaching the seen point has come down through the water above it; the
  // light leaving it crosses the tank to the glass. Water scatters its own colour into that path.
  // The scene's alpha is how much of the pixel a surface covers (multisampled edges are partial):
  // the surface's colour is unpremultiplied, seen through the water, and laid over open water by
  // that coverage, so outlines do not fringe dark.
  vec3 open = waterColor(p, d);
  vec3 underwater = open;
  // The seen point, and the way its surface faces from the depth slopes between neighbouring
  // pixels. Both are taken outside any branch: derivatives are undefined in divergent control flow.
  vec3 seen = seenPoint(uvR, texture(tDepth, uvR).r);
  vec3 facing = cross(dFdx(seen), dFdy(seen));
  float lightFacing = dot(facing, facing) > 0.0 ? max(dot(normalize(facing), uLightDir), 0.0) : 1.0;
  if (scene.a > 0.0) {
    vec3 ray = seen - uCamera;
    float path = max(uGlassZ - seen.z, 0.0) * length(ray) / max(-ray.z, 1e-3);
    float below = waterAbove(seen.xy, surfaceAtX(seen.x));
    vec3 lit = scene.rgb / scene.a * exp(-LIGHT_LOSS * below);
    // Caustics on whatever the light falls on, traced up along the light to where it crossed the
    // surface; strongest in the spotlight, on faces turned to the light, and fading with depth.
    if (below > 0.0) {
      vec2 entry = seen.xz + uLightDir.xz * (below / uLightDir.y);
      float c = caustic(entry * vec2(0.9, 1.3) + vec2(0.0, t * 0.02), t * 0.55);
      // The simulated surface where the light came through acts as a lens: a crest (curving down)
      // focuses it, a trough spreads it. Still water leaves the pattern as it is.
      float ce = 2.0 * uCell;
      float curvature = (surfaceAtX(entry.x + ce) - 2.0 * surfaceAtX(entry.x) + surfaceAtX(entry.x - ce)) / (ce * ce);
      c *= clamp(1.0 - 0.09 * curvature, 0.35, 2.6);
      float cone = 0.35 + 0.65 * min(1.0, spot(seen.xy) * 1.5);
      lit *= 1.0 + 1.8 * c * cone * (0.2 + 0.8 * lightFacing) * exp(-below * 0.9) * smoothstep(0.0, 0.04, below);
    }
    vec3 through = exp(-EXTINCTION * path);
    underwater = mix(open, lit * through + open * (1.0 - through), scene.a);
  }
  underwater += srgb(vec3(0.34, 0.5, 0.46)) * 0.12 * shafts(p, d);
  underwater += vec3(0.62, 0.8, 0.8) * texture(tBubbles, uvR).r;
  // Faint suspended grain.
  underwater *= 1.0 + 0.05 * (valueNoise(p * 60.0 + vec2(t * 0.3, 0.0)) - 0.5);

  vec3 col = mix(dry, underwater, water);

  // The meniscus, on the zero line of the same field that drew the water: along every edge it
  // has, the top, a sheet, a drop, the roof and floor of a pocket of air. The band of light under
  // it is light from above, so it lies under edges that face up and fades with the water above.
  float lw = 1.2 * uPixelRatio;
  float line = exp(-(edge * edge) / (lw * lw)) * reveal;
  float band = smoothstep(0.0, 5.0, -edge) * exp(-d / (22.0 * pxSim)) * smoothstep(-0.2, 0.6, n.y) * reveal;
  float topLight = 0.45 + 0.55 * min(1.0, spot(p) * 2.0);
  col += srgb(vec3(0.82, 0.95, 0.93)) * line * 0.9 * topLight;
  col += srgb(vec3(0.3, 0.5, 0.48)) * band * 0.16 * topLight;
  // Fast water near the top foams a little.
  float foam = smoothstep(2.0, 5.5, speed) * smoothstep(0.3, 0.8, density) * exp(-d * 8.0) * water;
  col = mix(col, srgb(vec3(0.75, 0.86, 0.85)), foam * 0.25);

  if (uView > 0.5) {
    fragColor = vec4(water, line, band, 1.0);
    return;
  }

  col = compressHighlights(max(col * uExposure, vec3(0.0)));
  vec3 display = toSrgb(clamp(col, 0.0, 1.0));
  display += (hash12(gl_FragCoord.xy + fract(t) * 91.0) - 0.5) / 255.0;
  fragColor = vec4(display, 1.0);
}
