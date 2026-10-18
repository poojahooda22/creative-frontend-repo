// Water optics, per sim unit (the view is 3 units tall), shared by the composite and the creatures.
// Fitted to the reference: a white digit face just under the surface reads (149, 175, 171) and
// three quarters of a unit deeper (76, 95, 95). Light from what is seen loses red first on its way
// out to the glass; sunlight loses a little red first on its way down to it.
const vec3 EXTINCTION = vec3(2.2, 1.5, 1.4);
const vec3 LIGHT_LOSS = vec3(1.9, 1.6, 1.55);
// The reference keeps its sand, stones, fish and crabs bright at the bottom of the tank while the
// digits fade with depth. Those surfaces are spared this fraction of LIGHT_LOSS: their shaders give
// it back before the composite takes the whole of it.
const float VIVID = 0.55;
