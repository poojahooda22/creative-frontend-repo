// Liquid glass button: one sphere-traced SDF body (two lobes, a bridge, droplets and a
// crown) shaded as clear glass with refraction, dispersion, absorption and Fresnel.
// MAX_DROPS, IOR and DISPERSION arrive as defines.

precision highp float;
precision highp int;

uniform vec2 uResolution;
uniform float uTime;

uniform vec3 uCamPos;
uniform mat3 uCamBasis; // columns: right, up, forward
uniform float uTanHalfFov;

uniform vec4 uLobe[4];   // xyz centre, w radius. 0,1 = current body; 2,3 = leaving body
uniform vec3 uLobeScale[4];
uniform vec4 uBody[2];   // x waist radius, y smooth-union radius, z enabled, w depth (z flattening)
uniform vec2 uJoin[2];   // x connect: 1 while the lobes are one body, 0 once the thread has retracted; y pill: 1 for the resting sag, 0 for a neck
uniform vec4 uWave;      // x centre, y amplitude, z half width, w wavenumber
uniform vec4 uBulge;     // xyz centre, w amplitude
uniform mat3 uTilt;      // world to body space rotation about the origin
uniform vec4 uDrop[MAX_DROPS];  // xyz head, w radius
uniform vec3 uDropTail[MAX_DROPS];
uniform int uDropCount;
// A loop start the compiler cannot fold. ANGLE's D3D11 backend fully unrolls short constant
// loops, which re-copies everything inside them; starting from ZERO keeps each loop body
// compiled once. Always 0 at run time.
#define ZERO min(uDropCount, 0)
uniform vec4 uCrown;     // xyz centre, w major radius
uniform vec3 uCrownAxis; // normal of the crown ring: the line of impact
uniform vec4 uCrownShape;  // collar tube radius, finger length, finger radius, tip bead radius
uniform vec4 uOrb;       // xyz, w intensity
uniform vec3 uBoundsMin;
uniform vec3 uBoundsMax;

uniform sampler2D uAtlas;
uniform vec4 uTextRect[4]; // atlas u, v, du, dv. 0,1 = word, arrow of body 0; 2,3 of body 1
uniform vec4 uTextPlace[4]; // xyz centre, w alpha
uniform vec2 uTextSize[4];  // world width, height
uniform vec4 uDivider[2];   // xyz centre, w alpha
uniform vec3 uTextNormal;   // the label plane faces the camera's elevation
uniform vec3 uTextUp;
uniform float uTexelWorld;
uniform float uTextBlur;

uniform float uFloorY;
uniform float uWarmth;
uniform float uExposure;
// 1 = full: dispersion and marched rims. 0 = lite, for slow GPUs: one exit lookup, no second march.
uniform float uQuality;

out vec4 fragColor;

const float DIVIDER_HALF_HEIGHT = 0.24;
const float DIVIDER_HALF_WIDTH = 0.0045;
const vec3 INK = vec3(0.018, 0.022, 0.036);
// Absorption per world unit: red goes first, so thick glass turns faintly blue.
const vec3 ABSORB = vec3(0.13, 0.09, 0.03);

// ---------------------------------------------------------------- SDF

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// Ellipsoid by domain scaling, from an offset already relative to the lobe centre.
// Not exact, so marching steps are scaled down.
float sdLobe(vec3 offset, int i) {
  vec3 s = uLobeScale[i];
  return (length(offset / s) - uLobe[i].w) * min(s.x, min(s.y, s.z));
}

// The join-to-lobe blend at rest: tight, so the lobes inside the join never swell the outline.
const float PILL_BLEND = 0.06;

// A tube between the lobe centres whose radius runs from the ends down to `waist` in the middle.
// At rest (pill 1) the ends stand PILL_ENDS proud of the lobes and the radius eases down along a
// smoothstep, so the outline sags in one gentle curve from cap to cap. As the waist thins (pill 0)
// it becomes an hourglass, then a thread at the break. `connect` shrinks the whole tube, so the
// broken thread retracts into the drops. Dividing by sqrt(1 + slope^2) keeps the bound valid where
// the radius changes fast (the cone correction).
float sdBridge(vec3 q, vec3 ca, vec3 cb, float ra, float rb, float waist, vec2 join) {
  vec3 pa = q - ca;
  vec3 ba = cb - ca;
  float len2 = max(dot(ba, ba), 1e-8);
  float h = clamp(dot(pa, ba) / len2, 0.0, 1.0);
  float pill = join.y;
  // While necking the ends stay well inside the lobes, so the tube never grazes a lobe surface
  // (where the smooth union would raise a ridge).
  float neckEnds = min(mix(ra, rb, h) * 0.94, waist + 0.25);
  float ends = mix(neckEnds, mix(ra, rb, h) * PILL_ENDS, pill);
  // The neck's power-1.5 profile is flat-bottomed at the waist like a parabola, but rises faster, so
  // the neck pinches to a point instead of holding a short straight bead. Both profiles change by at
  // most 1.5 per unit of u, so the radius's slope in h is at most 3 (ends - waist), plus the ends
  // sliding between unequal lobes at rest.
  float u = abs(2.0 * h - 1.0);
  float profile = mix(pow(u, 1.5), u * u * (3.0 - 2.0 * u), pill);
  float r = join.x * (waist + (ends - waist) * profile);
  float endsMax = mix(min(max(ra, rb) * 0.94, waist + 0.25), max(ra, rb) * PILL_ENDS, pill);
  float slope = (3.0 * abs(endsMax - waist) + abs(rb - ra) * PILL_ENDS * pill) * join.x * inversesqrt(len2);
  return (length(pa - ba * h) - r) * inversesqrt(1.0 + slope * slope);
}

// The resting pill is a lozenge, flatter front to back than it is tall. Squeezing z by `depth`
// keeps the front face shallow, so the label behind it is barely magnified. Multiplying by depth
// keeps the bound conservative (exact along z, which is the direction camera rays mostly travel).
float sdBody(vec3 p, int b) {
  int ia = 2 * b;
  int ib = ia + 1;
  float k = uBody[b].y;
  float depth = uBody[b].w;
  vec3 q = vec3(p.xy, p.z / depth);
  vec3 ca = vec3(uLobe[ia].xy, uLobe[ia].z / depth);
  vec3 cb = vec3(uLobe[ib].xy, uLobe[ib].z / depth);
  float d = smin(sdLobe(q - ca, ia), sdLobe(q - cb, ib), k);
  vec2 join = uJoin[b];
  if (join.x > 0.01) d = smin(d, sdBridge(q, ca, cb, uLobe[ia].w, uLobe[ib].w, uBody[b].x, join), mix(k, PILL_BLEND, join.y));
  return d * depth;
}

// Tapered capsule (Inigo Quilez, "round cone"): a round head of radius r1 at a, a thinner tail at b.
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a;
  float l2 = dot(ba, ba);
  float rr = r1 - r2;
  float a2 = l2 - rr * rr;
  // Too short to taper: a sphere.
  if (a2 < 1e-6) return length(p - a) - r1;
  float il2 = 1.0 / l2;
  vec3 pa = p - a;
  float y = dot(pa, ba);
  float z = y - l2;
  vec3 xv = pa * l2 - ba * y;
  float x2 = dot(xv, xv);
  float y2 = y * y * l2;
  float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

// Smooth-union radius between the crown and the body.
const float CROWN_BLEND = 0.1;
const float CROWN_FINGERS = 7.0;

// The collar thrown up where the drops meet: a torus around the line of impact, with
// CROWN_FINGERS tapered fingers rising from it, each ending in a bead. Every piece is an exact
// distance, and polar repetition evaluates only the finger in the point's sector and its nearer
// neighbour, so the field never overestimates and the march cannot step through a finger.
float sdCrown(vec3 p) {
  vec3 q = p - uCrown.xyz;
  vec3 axis = uCrownAxis;
  float along = dot(q, axis);
  vec3 radial = q - axis * along;
  float rho = length(radial);
  float ringRadius = uCrown.w;
  // A vanished collar would leave a zero-thickness ring line for the march to catch.
  float d = uCrownShape.x > 0.003 ? length(vec2(rho - ringRadius, along)) - uCrownShape.x : 1e3;
  if (uCrownShape.y > 0.002) {
    vec3 u = normalize(cross(axis, vec3(0.0, 1.0, 0.0)));
    vec3 v = cross(axis, u);
    float sector = 6.2831853 / CROWN_FINGERS;
    // atan(0, 0) is undefined; on the axis every finger is equally far.
    float slot = (rho < 1e-5 ? 0.0 : atan(dot(radial, v), dot(radial, u))) / sector;
    float side = fract(slot) < 0.5 ? -1.0 : 1.0;
    for (int k = ZERO; k < 2; k++) {
      // The sector's own finger, then the neighbour on the nearer side. Each finger takes its own
      // length, lean and offset from a hash of its sector, so the crown reads as liquid, not a wheel.
      float s = floor(slot) + (k == 0 ? 0.0 : side);
      float h = fract(sin(s * 12.9898 + 4.1) * 43758.5453);
      float a = (s + 0.5 + 0.3 * (h - 0.5)) * sector;
      vec3 outward = cos(a) * u + sin(a) * v;
      vec3 base = outward * ringRadius;
      vec3 tip = base + normalize(outward * 0.8 + axis * (0.35 + 0.45 * h)) * uCrownShape.y * (0.55 + 0.45 * fract(h * 7.31));
      float finger = sdRoundCone(q, base, tip, uCrownShape.z, max(0.65 * uCrownShape.z, 0.004));
      float bead = length(q - tip) - uCrownShape.w * (0.75 + 0.5 * h);
      d = smin(d, smin(finger, bead, 0.03), 0.07);
    }
  }
  return d;
}

vec3 toBody(vec3 pw) {
  return uTilt * pw;
}

// Which drops (bit i) and whether the crown the current march segment can reach. Set once per
// segment by cullSegment(), read by every map() call along it: during the splash this cuts the
// droplet work per step from all thirteen to the two or three a ray actually passes.
int gDropMask = 0;
bool gCrownNear = false;

// Distance from a segment (origin o, unit direction d, length len) to a point.
float segmentDistance(vec3 o, vec3 d, float len, vec3 c) {
  float s = clamp(dot(c - o, d), 0.0, len);
  return length(o + d * s - c);
}

void cullSegment(vec3 fromW, vec3 dirW, float len) {
  vec3 o = toBody(fromW);
  vec3 d = uTilt * dirW;
  // Bounding spheres grow by the smooth-union reach (k = 0.1 for drops, 0.12 for the crown).
  gDropMask = 0;
  for (int i = ZERO; i < MAX_DROPS; i++) {
    if (i >= uDropCount) break;
    vec4 dr = uDrop[i];
    vec3 tail = uDropTail[i];
    float reach = dr.w + 0.5 * length(tail) + 0.12;
    if (segmentDistance(o, d, len, dr.xyz + 0.5 * tail) < reach) gDropMask |= 1 << i;
  }
  // The crown reaches the ring radius plus a finger and its bead.
  float crownReach = uCrown.w + uCrownShape.y + max(uCrownShape.x, 1.25 * uCrownShape.w) + CROWN_BLEND + 0.07;
  gCrownNear = (uCrownShape.x > 0.003 || uCrownShape.y > 0.002) && segmentDistance(o, d, len, uCrown.xyz) < crownReach;
}

float map(vec3 pw) {
  vec3 p = toBody(pw);
  float d = sdBody(p, 0);
  if (uBody[1].z > 0.5) d = smin(d, sdBody(p, 1), uBody[1].y);

  // The groove: a dent running along the pill, leaning like a fold (its front runs diagonally across
  // the face) and strongest on the top and front, where the reference shows its creases. Its slope
  // adds to the field's, so near the packet the distance is divided by the bound
  // 1 + |A|(k + 1.7 sqrt(1 + lean^2) / w + 2) (envelope-weighted; the 2 covers the angular weight),
  // which keeps the march from stepping through it.
  float wx = p.x - uWave.x + 0.45 * p.y;
  float envelope = exp(-wx * wx / (uWave.z * uWave.z));
  float facing = 0.6 + 0.4 * smoothstep(-0.3, 0.9, dot(normalize(p.yz + vec2(1e-5)), vec2(0.55, 0.835)));
  d = (d - uWave.y * envelope * facing * cos(uWave.w * wx)) / (1.0 + abs(uWave.y) * envelope * (uWave.w + 1.87 / uWave.z + 2.0));

  vec3 bp = p - uBulge.xyz;
  d -= uBulge.w * exp(-dot(bp, bp) * 5.0);

  if (gCrownNear) d = smin(d, sdCrown(p), CROWN_BLEND);

  for (int i = ZERO; i < MAX_DROPS; i++) {
    if (i >= uDropCount) break;
    if (((gDropMask >> i) & 1) == 0) continue;
    vec4 dr = uDrop[i];
    d = smin(d, sdRoundCone(p, dr.xyz, dr.xyz + uDropTail[i], dr.w, dr.w * 0.4), 0.1);
  }
  return d;
}

// Tetrahedral gradient (xyz, normalised) plus the distance at p (w): the four samples average to
// d(p) to first order, so the caller gets the hit offset without another map() call. Written as
// a loop so map() is compiled once here, not four times.
vec4 gradient(vec3 p, float h) {
  vec4 acc = vec4(0.0);
  for (int i = ZERO; i < 4; i++) {
    vec3 e = 0.5773 * (2.0 * vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0);
    float d = map(p + e * h);
    acc += vec4(e * d, d);
  }
  return vec4(normalize(acc.xyz), acc.w * 0.25);
}

bool boxRange(vec3 ro, vec3 rd, out float t0, out float t1) {
  vec3 inv = 1.0 / rd;
  vec3 ta = (uBoundsMin - ro) * inv;
  vec3 tb = (uBoundsMax - ro) * inv;
  vec3 lo = min(ta, tb);
  vec3 hi = max(ta, tb);
  t0 = max(max(lo.x, lo.y), max(lo.z, 0.0));
  t1 = min(min(hi.x, hi.y), hi.z);
  return t1 > t0;
}

// ---------------------------------------------------------------- environment

// Brightness of a soft rectangular light seen along rd, by gnomonic projection onto its plane.
// halfSize.x runs horizontally across the light, halfSize.y up it. With constant arguments the
// basis folds away at compile time.
float softbox(vec3 rd, vec3 dir, vec2 halfSize, float soft) {
  float c = dot(rd, dir);
  if (c <= 0.0) return 0.0;
  vec3 hint = abs(dir.y) > 0.98 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 u = normalize(cross(hint, dir));
  vec3 v = cross(dir, u);
  vec2 q = vec2(dot(rd, u), dot(rd, v)) / c;
  vec2 e = abs(q) - halfSize;
  float dist = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
  return 1.0 - smoothstep(-soft, soft, dist);
}

// A small round light: the sparkles on the drops.
float spot(vec3 rd, vec3 dir, float radius) {
  float a = 1.0 - dot(rd, dir);
  return 1.0 - smoothstep(radius * 0.6, radius, sqrt(max(a, 0.0) * 2.0));
}

vec3 wallColour(vec3 rd) {
  vec3 cool = vec3(0.70, 0.755, 0.875);
  vec3 warm = vec3(0.69, 0.645, 0.77);
  vec3 c = mix(cool, warm, uWarmth);
  c *= 1.0 - 0.06 * smoothstep(0.0, 0.5, rd.y);
  // A warm wash from the upper left once the light warms.
  c += vec3(0.045, 0.012, 0.028) * uWarmth * smoothstep(0.5, 1.0, dot(rd, normalize(vec3(-0.65, 0.3, -0.7))));
  return c;
}

// Darker where the far floor meets the wall. Symmetric about the horizon, so it is continuous.
float horizonBand(vec3 rd) {
  return 1.0 - 0.09 * exp(-rd.y * rd.y / (0.12 * 0.12));
}

float floorShadow(vec2 fp, vec3 a, vec3 b, float ra, float rb, float h) {
  // Distance from the floor point to the body's footprint segment. The key light is high and
  // behind, so the shadow falls toward the camera as the body rises.
  fp.y -= 0.12 + 0.1 * h;
  vec2 pa = fp - a.xz;
  vec2 ba = b.xz - a.xz;
  float s = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - ba * s);
  float r = mix(ra, rb, s);
  float spread = r * (0.6 + 0.7 * h);
  float strength = 0.32 / (1.0 + 1.0 * h);
  return strength * exp(-d * d / (spread * spread));
}

// The glass focuses light into a tight core inside its shadow. Each channel focuses
// at a slightly different width, which tints the rim of the core.
vec3 floorCaustic(vec2 fp, vec3 a, vec3 b, float ra, float rb, float h) {
  // Focused just past the front edge, where the camera can see it.
  fp.y -= 0.32 + 0.1 * h;
  vec2 pa = fp - a.xz;
  vec2 ba = b.xz - a.xz;
  float s = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - ba * s);
  float r = mix(ra, rb, s) * (0.32 + 0.3 * h);
  vec3 w = r * vec3(1.1, 1.0, 0.88);
  return vec3(0.95, 1.05, 1.3) / (1.0 + 1.0 * h) * exp(-d * d / (w * w));
}

vec3 backdrop(vec3 ro, vec3 rd) {
  vec3 wall = wallColour(rd);
  if (rd.y >= 0.0) return wall * horizonBand(rd);
  float t = (uFloorY - ro.y) / rd.y;
  vec3 fp = ro + rd * t;
  vec3 cool = vec3(0.665, 0.715, 0.845);
  vec3 warm = vec3(0.665, 0.645, 0.79);
  vec3 floorCol = mix(cool, warm, uWarmth);
  // A pool of light under the subject.
  floorCol *= 1.0 + 0.06 * exp(-dot(fp.xz, fp.xz) * 0.15);
  float shade = 0.0;
  vec3 caustic = vec3(0.0);
  for (int b = ZERO; b < 2; b++) {
    if (b == 1 && uBody[1].z < 0.5) break;
    vec4 la = uLobe[2 * b];
    vec4 lb = uLobe[2 * b + 1];
    float h = max(0.0, min(la.y - la.w, lb.y - lb.w) - uFloorY);
    shade += floorShadow(fp.xz, la.xyz, lb.xyz, la.w, lb.w, h);
    caustic += floorCaustic(fp.xz, la.xyz, lb.xyz, la.w, lb.w, h);
  }
  floorCol *= 1.0 - min(shade, 0.6);
  floorCol += caustic * floorCol;
  // The floor fades into the wall colour at the horizon, so the two meet without a seam.
  float fog = 1.0 - exp(-max(t - 1.5, 0.0) * 0.16);
  return mix(floorCol, wall, fog) * horizonBand(rd);
}

// What a ray sees of the room. studio 0: the backdrop as the camera sees it. studio 1: the same
// room plus the studio rig that sits out of frame, which only the glass reflects and refracts.
// Light directions are solved from the reference: each is the mirror direction for the surface
// normal where that highlight appears, seen from the resting camera.
vec3 lookup(vec3 ro, vec3 rd, float studio) {
  vec3 c = backdrop(ro, rd);
  if (studio < 0.5) return c;
  // A studio ceiling is dark apart from its lights. Surfaces that bend rays upward (the lower
  // half of a drop, the underside of the pill) find it, which gives the glass its dark crescents.
  // This only lights the glass: the backdrop the camera sees is unchanged.
  // Only the steepest bends reach straight up, which darkens just the lower rims of the drops.
  c *= 1.0 - 0.2 * smoothstep(0.6, 0.95, rd.y);
  // Away from the view axis the studio is dark and cool. Near a drop's rim refraction bends rays
  // hardest, out to these directions, which is what gives clear glass its thick blue-grey edge.
  float offAxis = 1.0 - clamp(-rd.z, 0.0, 1.0);
  c *= mix(vec3(1.0), vec3(0.86, 0.88, 0.94), smoothstep(0.35, 0.95, offAxis));
  // A large soft light up and behind: rays leaving through the pill's top rim find it, so the
  // crest reads light, as in the reference, while straight up stays dark.
  c += 2.2 * softbox(rd, normalize(vec3(0.0, 0.62, -0.78)), vec2(1.2, 0.35), 0.25);
  // Overhead strip, mirrored by the crest of the pill: the long line along its top.
  c += 5.0 * softbox(rd, normalize(vec3(0.0, 0.96, -0.27)), vec2(1.4, 0.3), 0.1);
  // Windows high left and right: the soft square highlights on each lobe's upper corners.
  c += vec3(6.0, 6.3, 6.8) * softbox(rd, normalize(vec3(-0.85, 0.42, 0.1)), vec2(0.2, 0.14), 0.04);
  c += vec3(4.4, 4.6, 5.0) * softbox(rd, normalize(vec3(0.85, 0.42, 0.1)), vec2(0.16, 0.12), 0.04);
  // Windows behind the camera: soft rectangles on the shallow front face, upper corners of each lobe.
  c += 11.0 * softbox(rd, normalize(vec3(-0.45, 0.35, 0.82)), vec2(0.12, 0.09), 0.04);
  c += 8.0 * softbox(rd, normalize(vec3(0.45, 0.35, 0.82)), vec2(0.1, 0.075), 0.04);
  // Lower bounce cards, fainter: the highlights on the lower corners.
  c += 1.6 * softbox(rd, normalize(vec3(-0.8, -0.3, 0.5)), vec2(0.22, 0.08), 0.06);
  c += 1.2 * softbox(rd, normalize(vec3(0.8, -0.3, 0.5)), vec2(0.18, 0.08), 0.06);
  // Small round lamps: the sparkles on the free drops.
  c += 16.0 * spot(rd, normalize(vec3(0.75, 0.64, 0.12)), 0.085);
  c += 10.0 * spot(rd, normalize(vec3(-0.6, 0.72, 0.36)), 0.07);
  // Dark flags behind each side: they give the glass its dark inner contour.
  c *= 1.0 - 0.32 * softbox(rd, normalize(vec3(-0.9, 0.05, -0.45)), vec2(0.3, 0.5), 0.3);
  c *= 1.0 - 0.32 * softbox(rd, normalize(vec3(0.9, 0.05, -0.45)), vec2(0.3, 0.5), 0.3);
  // Coloured cards low behind each side: pink in the left cap, lilac in the right.
  c = mix(c, vec3(0.98, 0.62, 0.76), 0.32 * softbox(rd, normalize(vec3(-0.75, -0.35, -0.55)), vec2(0.35, 0.3), 0.25));
  c = mix(c, vec3(0.74, 0.66, 1.0), 0.28 * softbox(rd, normalize(vec3(0.75, -0.35, -0.55)), vec2(0.35, 0.3), 0.25));
  return c;
}

// ---------------------------------------------------------------- label inside the glass

// `pixel` is the world size of a pixel per unit of distance; `tBase` is how far the ray
// travelled before entering the glass. Together they pick the mip level at the label.
float textCoverage(vec3 roW, vec3 rdW, float tMax, float pixel, float tBase) {
  vec3 ro = toBody(roW);
  vec3 rd = uTilt * rdW;
  float denom = dot(rd, uTextNormal);
  if (abs(denom) < 1e-4) return 0.0;
  vec3 side = cross(uTextUp, uTextNormal);
  float cover = 0.0;
  for (int i = ZERO; i < 4; i++) {
    vec4 place = uTextPlace[i];
    if (place.w < 0.01) continue;
    float t = dot(place.xyz - ro, uTextNormal) / denom;
    if (t <= 0.0 || t >= tMax) continue;
    vec3 q = ro + rd * t - place.xyz;
    vec2 uv = vec2(dot(q, side), dot(q, uTextUp)) / uTextSize[i] + 0.5;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) continue;
    vec4 rect = uTextRect[i];
    vec2 st = rect.xy + vec2(uv.x, 1.0 - uv.y) * rect.zw;
    // Fade to nothing at the cell edge, so blurred ink never ends in a straight line.
    vec2 edge = smoothstep(vec2(0.0), vec2(0.08), uv) * smoothstep(vec2(0.0), vec2(0.08), 1.0 - uv);
    float lod = log2(max(pixel * (tBase + t) / uTexelWorld, 1e-3)) + uTextBlur * 2.8;
    float a = textureLod(uAtlas, st, max(lod, 0.0)).r * place.w * edge.x * edge.y;
    cover = cover + (1.0 - cover) * a;
  }
  for (int b = ZERO; b < 2; b++) {
    vec4 dv = uDivider[b];
    if (dv.w < 0.01) continue;
    float t = dot(dv.xyz - ro, uTextNormal) / denom;
    if (t <= 0.0 || t >= tMax) continue;
    vec3 q = ro + rd * t - dv.xyz;
    vec2 xy = vec2(dot(q, side), dot(q, uTextUp));
    float w = max(pixel * (tBase + t) * 0.5, 1e-4);
    float line = (1.0 - smoothstep(DIVIDER_HALF_WIDTH - w, DIVIDER_HALF_WIDTH + w, abs(xy.x)))
      * (1.0 - smoothstep(DIVIDER_HALF_HEIGHT - w, DIVIDER_HALF_HEIGHT + w, abs(xy.y)));
    cover = cover + (1.0 - cover) * line * dv.w * 0.85;
  }
  return cover;
}

// Light from the inner orb along a segment: a closed-form integral of 1 / (h^2 + s^2),
// plus a tight core where the segment passes right through it.
vec3 orbGlow(vec3 ro, vec3 rd, float tMax) {
  if (uOrb.w < 0.01) return vec3(0.0);
  vec3 o = uOrb.xyz;
  float s0 = dot(o - ro, rd);
  float h = max(length(ro + rd * clamp(s0, 0.0, tMax) - o), 0.004);
  float hr = length(ro + rd * s0 - o) + 0.012;
  float integral = (atan((tMax - s0) / hr) - atan(-s0 / hr)) / hr;
  // A hard white core about 0.028 across, a short blue halo, and a faint long falloff.
  float core = 1.0 - smoothstep(0.022, 0.045, h);
  float halo = exp(-h * h / (0.09 * 0.09));
  return uOrb.w * (vec3(0.8, 0.88, 1.0) * (0.004 * integral + 0.9 * halo) + vec3(1.0) * 8.0 * core);
}

// ---------------------------------------------------------------- shading

// ANGLE's D3D11 backend (Chrome on Windows) inlines every call, so each call site of map() or
// lookup() is compiled again. The trace is therefore one march loop over three phases, one
// gradient loop and one lookup loop: each heavy function has a single call site.

const float F0 = ((IOR - 1.0) / (IOR + 1.0)) * ((IOR - 1.0) / (IOR + 1.0));
// Room lookups per pixel, packed in this order so a pixel loops only over what it uses:
// 0 backdrop, 1 reflection, 2 inner reflection, 3 to 5 exits (one per channel, or one at lite),
// 6 the rim path. Backdrop pixels look up 1, lite glass 4, full glass 6, rims 7.
const int LOOKUPS = 7;
const int RIM = 6;

float schlick(float cosTheta) {
  return F0 + (1.0 - F0) * pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
}

// Khronos PBR Neutral tone mapping.
vec3 neutralTonemap(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
  float aspect = uResolution.x / uResolution.y;
  vec3 rd = normalize(uCamBasis * vec3(ndc.x * uTanHalfFov * aspect, ndc.y * uTanHalfFov, 1.0));
  vec3 ro = uCamPos;
  // World size of one pixel at unit distance.
  float pixel = 2.0 * uTanHalfFov / uResolution.y;

  // Everything this pixel needs from the room is gathered first and looked up in one loop below.
  // Slots below lookCount are always written before the loop reads them.
  vec3 lookFrom[LOOKUPS];
  vec3 lookDir[LOOKUPS];
  float lookStudio[LOOKUPS];
  lookFrom[0] = ro;
  lookDir[0] = rd;
  lookStudio[0] = 0.0;
  int lookCount = 1;

  bool glass = false;
  float coverage = 0.0;
  float tHit = 0.0;
  vec3 hitPos = ro;
  vec3 hitNormal = -rd;
  vec3 inDir = rd;
  float firstPath = 0.0;
  float rimPath = 0.0;
  float rimWeight = 0.0;
  vec3 fExit = vec3(0.0);

  float t0;
  float t1;
  if (boxRange(ro, rd, t0, t1)) {
    vec3 from = ro;
    vec3 dir = rd;
    float sgn = 1.0;
    const float eps = 0.0012;
    // Phase 0 takes the camera ray to the glass, phase 1 through the glass to its exit, and
    // phase 2 (rims only) through the glass again after the inner reflection.
    for (int phase = ZERO; phase < 3; phase++) {
      bool outer = phase == 0;
      float t = outer ? t0 : 0.0;
      float tEnd = t1;
      if (!outer) {
        // Inside the glass the segment ends where it leaves the bounds.
        float inStart;
        boxRange(from, dir, inStart, tEnd);
        tEnd = min(tEnd, 6.0);
      }
      cullSegment(from, dir, tEnd);
      float bestRatio = 1e9;
      float bestT = t;
      bool found = false;
      for (int i = ZERO; i < 110; i++) {
        float d = sgn * map(from + dir * t);
        if (outer) {
          float ratio = d / t;
          if (ratio < bestRatio) {
            bestRatio = ratio;
            bestT = t;
          }
          if (d < pixel * t * 0.3) {
            found = true;
            break;
          }
          t += d * 0.82;
        } else {
          if (d < eps) {
            found = true;
            break;
          }
          t += max(d * 0.85, eps);
        }
        if (t > tEnd) break;
      }
      if (outer) {
        // Silhouette coverage from the closest approach of a ray that missed.
        coverage = found ? 1.0 : clamp(1.0 - bestRatio / (pixel * 0.9), 0.0, 1.0);
        if (coverage <= 0.0) break;
        if (!found) t = bestT;
      }
      vec3 p = from + dir * t;
      vec4 g = gradient(p, outer ? max(0.0012, pixel * t * 0.5) : 0.0015);
      vec3 n = g.xyz;

      if (phase == 0) {
        // A grazing near miss has a normal facing away; fold it so Fresnel reads as a rim.
        if (dot(n, rd) > 0.0) n = normalize(n - rd * dot(n, rd) * 1.01);
        glass = true;
        tHit = t;
        hitPos = p;
        hitNormal = n;
        inDir = refract(rd, n, 1.0 / IOR);
        lookFrom[1] = p;
        lookDir[1] = reflect(rd, n);
        lookStudio[1] = 1.0;
        lookCount = 2;
        // The outer march stops within a pixel-scaled tolerance, which far from the camera can
        // leave p well outside the surface. Step in by the measured distance, or the inner march
        // starts outside the glass and exits at once (concentric rings on a phone-distance camera).
        from = p - n * (max(g.w, 0.0) + eps * 3.0);
        dir = inDir;
        sgn = -1.0;
      } else if (phase == 1) {
        firstPath = t;
        // Leaving the glass: part refracts out, part reflects back in, weighted by Fresnel
        // (Schlick on the outside angle, which reaches 1 at the critical angle), so the image
        // stays continuous across the total internal reflection boundary.
        vec3 inward = -n;
        vec3 bounce = reflect(dir, inward);
        lookFrom[2] = p;
        lookDir[2] = bounce;
        lookStudio[2] = 1.0;
        lookCount = 3;
        // Dispersion: each channel leaves at its own index. The lite tier shares one exit.
        // Scalar selects rather than vector indexing, which ANGLE emulates slowly.
        float spread = uQuality > 0.5 ? DISPERSION : 0.0;
        int exits = uQuality > 0.5 ? 3 : 1;
        for (int c = ZERO; c < 3; c++) {
          if (c >= exits) break;
          float eta = IOR + spread * (c == 0 ? -0.6 : (c == 1 ? 0.0 : 1.0));
          vec3 o = refract(dir, inward, eta);
          bool tir = dot(o, o) < 1e-6;
          float f = tir ? 1.0 : schlick(dot(o, n));
          if (c == 0) fExit.x = f;
          else if (c == 1) fExit.y = f;
          else fExit.z = f;
          lookFrom[3 + c] = p;
          lookDir[3 + c] = tir ? bounce : o;
          lookStudio[3 + c] = 1.0;
          lookCount = 4 + c;
        }
        if (exits == 1) fExit = vec3(fExit.x);
        // Where the reflected share is large (near and past the critical angle: the rims) it is
        // marched through the glass and refracted out, which draws the dark inner contours.
        // Elsewhere it is looked up directly. The two cross-fade over Fresnel 0.2 to 0.4.
        rimWeight = smoothstep(0.2, 0.4, fExit.g);
        if (uQuality < 0.5 || rimWeight <= 0.0) break;
        from = p - n * eps * 3.0;
        dir = bounce;
      } else {
        rimPath = t;
        vec3 out2 = refract(dir, -n, IOR);
        lookFrom[RIM] = p;
        lookDir[RIM] = dot(out2, out2) < 1e-6 ? reflect(dir, -n) : out2;
        lookStudio[RIM] = 1.0;
        lookCount = RIM + 1;
      }
    }
  }

  vec3 seen[LOOKUPS];
  for (int k = ZERO; k < LOOKUPS; k++) {
    if (k >= lookCount) break;
    seen[k] = lookup(lookFrom[k], lookDir[k], lookStudio[k]);
  }

  vec3 col = seen[0];
  if (glass) {
    // The inner reflection, clamped so the hot lights do not print squares or milk the rims.
    vec3 inner = min(seen[2], vec3(1.25));
    if (lookCount > RIM) inner = mix(inner, min(seen[RIM], vec3(1.4)) * exp(-ABSORB * rimPath), rimWeight);
    vec3 exits = uQuality > 0.5 ? vec3(seen[3].r, seen[4].g, seen[5].b) : seen[3];
    vec3 trans = mix(exits, inner, fExit);

    // The label and the orb sit on the first pass through the glass.
    float ink = textCoverage(hitPos, inDir, firstPath, pixel, tHit);
    // Seen through a thick round drop, the ink scatters and lightens.
    trans = mix(trans, INK, ink * (1.0 - 0.3 * uTextBlur));
    trans *= exp(-ABSORB * firstPath);
    trans += orbGlow(hitPos, inDir, firstPath);

    float fresnel = schlick(dot(-rd, hitNormal));
    // Light from the orb on the surface around it.
    vec3 toOrb = hitPos - uOrb.xyz;
    float near = exp(-dot(toOrb, toOrb) * 30.0) * uOrb.w;
    vec3 glassCol = mix(trans, seen[1], fresnel) + vec3(0.06, 0.065, 0.08) * near;
    col = mix(seen[0], glassCol, coverage);
  }

  col = neutralTonemap(col * uExposure);
  col = toSrgb(col);
  // Half-LSB dither so the soft backdrop does not band.
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
