// Each particle adds Zhu and Bridson's kernel k = (1 - s^2)^3, s its distance over the kernel
// radius, to four sums: k; k times the offset from the particle to this pixel (x, then y up, in
// kernel radii); and k times the particle's speed. The composite turns them into the particles'
// surface (see waterField) and the foam.
precision highp float;

in float vSpeed;
out vec4 fragColor;

void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 >= 1.0) discard;
  float k = 1.0 - r2;
  k = k * k * k;
  // gl_PointCoord runs down the point; the sim's y runs up.
  fragColor = vec4(k, k * q.x, -k * q.y, k * min(vSpeed, 8.0));
}
