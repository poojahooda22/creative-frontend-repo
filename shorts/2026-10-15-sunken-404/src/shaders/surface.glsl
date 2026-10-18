// The drawn water surface, one texel per grid column (sim units), in three rows (see
// World.displaySurface): 0 the volume line, 1 the top of the water above it, 2 how much water lies
// above it.
uniform sampler2D tSurface;
uniform float uColumns;
uniform float uCell;

float lineColumn(float i, int row) {
  return texelFetch(tSurface, ivec2(int(clamp(i, 0.0, uColumns - 1.0)), row), 0).r;
}

// Catmull-Rom between columns: the slope is continuous, so the drawn line has no corner at each
// column the way a linear blend does.
float lineAtX(float x, int row) {
  float c = x / uCell - 0.5;
  float i = floor(c);
  float f = c - i;
  float p0 = lineColumn(i - 1.0, row);
  float p1 = lineColumn(i, row);
  float p2 = lineColumn(i + 1.0, row);
  float p3 = lineColumn(i + 2.0, row);
  return p1 + 0.5 * f * (p2 - p0 + f * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + f * (3.0 * (p1 - p2) + p3 - p0)));
}

float surfaceAtX(float x) {
  return lineAtX(x, 0);
}

float topAtX(float x) {
  return lineAtX(x, 1);
}

float aboveAtX(float x) {
  return max(lineAtX(x, 2), 0.0);
}
