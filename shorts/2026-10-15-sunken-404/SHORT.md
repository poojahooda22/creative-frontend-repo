# Sunken 404

- **Date:** 2026-10-15
- **Concept:** A 404 page that sank: an aquarium of live FLIP water you stir with the cursor (or slosh by tilting your phone), with floating 404 digits you can fish out and toss back, and fish, crabs and seaweed that live in it.
- **Reference:** [Damir Sokolovsky, "404 but aquarium"](https://x.com/heydamir/status/2110309171111338091), a screen recording of a "This page sank" 404 page.
- **Principle:** an error page earns a second look by turning the error into a place. The digits are physical objects in a body of water that obeys physics, so every input (a cursor, a shaken window, a dragged digit) has a consequence you can watch play out.
- **The page:** a product's 404, not a showcase. A study of the live 404 pages of 20 product sites (Figma, Framer, Arc, Stripe, GitHub, Apple, Supabase, Webflow, Dribbble, Slack and others) found the strongest keep their own header, say what happened in one sentence, and let one interaction carry the brand. So: the product's header with Log in and Get started; one heading, one line ("The link may be broken, or the page has moved.") and two ways back, Back to home and Get help; the water's invitation set apart in a chip at the foot. On a phone, one prominent button per view, as Apple's guidelines ask: Log in alone in the header, Back to home alone in the hero. The product (a placeholder, Plinth) and its links live in one `PRODUCT` constant in `App.tsx`, so the page fits any product.
- **Sizes on phones:** from the platforms' own specs. Type follows Apple's iOS text styles (Large Title 34/41 for the heading, Body 17/22 under it; Title 1 28 and Subhead 15 on short phones), against Material 3's Display Small 36/44 and Body Large 16/24. Buttons follow Apple's 44 pt hit region (Log in, and the way back on a phone on its side), Apple's 52 pt Large capsule with Material 3's 24 dp medium side padding (Back to home, 52 px tall, 240 wide, 17 px semibold label) and Material's 48 dp minimum touch target on short phones. On touch screens every button is at least 44 px tall; with a mouse the header's are 40.
- **The spotlight:** it comes in past the top edge between the headline and the header's buttons and falls down to the left, 36.5° from vertical, as measured from the beam's centre in two of the reference's frames (35° and 38.5°, entering at 0.74 and 0.76 of the width). The key light on the digits comes from the same side at the same angle.
- **Technique:**
  - **Water:** a 2D FLIP fluid in a Web Worker. It is a port of Matthias Müller's Ten Minute Physics tutorial 18, with particle separation with velocity smoothing, and drift compensation both ways: compressed water pushes out, and loosened water deep in the body draws back in, so a stir leaves no fluffy hump standing. The water is gently damped (0.3 a second), which leaves it sloshing for seconds after a splash, as the reference's does.
    - **Pace:** the view is 3 units tall, so with gravity at 9.81 the water moved like a 3 m pool's, slow for a tank on a screen. The tank's clock runs 1.4 times faster than the page's: each frame advances it by 1.4 times the frame's time, in steps of 1/60 s of tank time, so the solver keeps the gravity and step it was tuned at. Scaling gravity instead looked the same but packed the particles harder every step, and still water never read as calm.
    - **Digits in the water:** solid bodies, as in the reference and in Müller's demo. Water may leave a digit but never enter it, pockets a digit seals are vented, and the part of a digit standing out of the water is open to the grid, so a lifted 0 does not carry the water in its counter up with it (a cup in 2D, a hole through a slab in truth) and drops fall through it.
    - **The surface:** one signed distance field draws both the water and its meniscus, so the line can never part from the water. Below the volume line is the body: the distance to that line, which per column is about the height the water's volume fills, from the floor up to the first air gap, through the digits. Above it the water is what the particles say: Zhu and Bridson's surface, the distance to the kernel-weighted mean of the nearby particles less a particle's radius, read off splats drawn between each particle's last two steps. So a drop is a disc, a sheet a strip, and a pocket of air trapped in a slosh a hole with a rim, as in the reference. A smooth union joins the two where a crest rises out of the body, and the edge is measured against the field's own gradient, so the meniscus keeps one width everywhere.
    - **Still water:** flat. A particle near the line where the water moves slower than a stir is drawn sunk under the line, by as much as the water there is still: the particles' jostle and their few-pixel biases against the line never reach resting water, and settling water sinks into the line whole instead of thinning to specks. A particle at rest in a digit's open top is not drawn. Two more rows per column, how much water lies above the line and where it ends, shade the water by the water over it, continuously through every shape it takes. The drawn line follows the simulated one through a Gaussian across columns and a critically damped spring per column whose rate rises with how far it trails, as the 1€ filter raises its cutoff with speed: still water is filtered hard, a wave is followed at once, and the spring is stepped in closed form so it is stable at any rate.
    - **Ripples:** a fine wave layer on the drawn surface that the cursor sets going where it moves through or skims the water. It is a damped 1D wave equation, the height-field water of three.js's `webgl_gpgpu_water` example and Evan Wallace's WebGL Water, laid over the simulated surface.
    - **Still water:** the FLIP blend slides toward PIC as the water calms, the digits' slow heave and roll are damped (a stand-in for the losses a real tank has around a slab, fading out for a toss or a ride on a wave), and a slow two-wave swell keeps it alive, as the owner's fluid experiment sways its resting water.
  - **Digits:** 2D rigid bodies shaped by the real Geist glyphs. A canvas raster becomes a signed distance field (Felzenszwalb–Huttenlocher) and a traced outline. The water lifts them with buoyancy, holds them back with drag and added mass, and a ballast keeps them upright, set under the centre of the water each glyph displaces (trimmed, as a ship is) so the lopsided 4 floats level. A loose mooring brings the 404 back together. Sequential-impulse contacts with accumulated impulses, as in Box2D Lite, and a grab spring.
  - **Tilt:** on a phone the tank's gravity follows the phone. `deviceorientation`'s beta and gamma give the world's down vector in the device's frame; the screen's rotation turns it into the page's axes. The water runs to the low side and settles level with the world, the digits float level with it, the seaweed reaches up and the bubbles rise along the new up. Each layout eases off tilt it could not hold (water climbing out of the low side). Shaking the phone (`devicemotion`) splashes it. iOS asks first, from a "Turn on tilt" chip; both events need HTTPS.
  - **Frame budget:** a refresh-aware governor, carried over from the liquid glass short, judges each 0.6 s of frames, by GPU time where the browser exposes timer queries. It sheds multisampling first, then pixel ratio, and steps back up after recovering. Start-up overlaps: the worker announces the layout before settling the water, while the page bakes its environment light and compiles the tank's shaders in parallel.
  - **Particle budget:** the grid is no finer than a budget of particles pays for: 10,000 on a desktop, 5,500 on a touch screen, never so coarse that a digit has fewer than 13 cells across. The worker times its first settling steps and, if they run slow on this device, builds the tank again smaller before the first frame.
  - **Rendering:** three.js. The tank (extruded digits, sand, fish, crabs, seaweed, stones) renders into a multisampled half-float target with depth. A full-screen pass then shades the water:
    - it rebuilds each pixel's position from depth;
    - light loses red first on the way down to a surface and on the way out to the glass (Beer–Lambert, fitted to colours measured from the reference);
    - caustics are traced up along the light to the surface;
    - spotlight shafts, and the meniscus on every edge of the water;
    - highlight compression from Khronos PBR Neutral, without its toe.
  - **Life:**
    - **Fish:** one instanced mesh of procedural bodies with a swim wave travelling down the body, its amplitude growing toward the tail as measured in saithe. Each species (clownfish, blue tang, minnow) is painted in the shader. They swim at measured speeds (1 to 2 body lengths a second, bursts to 3 or more) with a tail beat tied to speed at a Strouhal number near 0.3. Clownfish and tangs row with their pectoral fins at low speed; minnows burst and coast. They school a body length apart, turn with a critically damped bend, look ahead to avoid the surface, sand and glass, startle from a stirring hand and drift with the simulated current.
    - **Crabs:** primitives in one mesh whose legs and claws the vertex shader moves. They walk sideways, wave, square up to a slow hand and run from a fast one.
    - **Seaweed:** bends with the current through a damped spring per plant.
    - **Bubbles:** composited after the water, with their own depth test.
- **Skills used:** short-craft, design-taste-frontend, fluid-simulation, glsl-mastery, 3d-underwater-god-rays, red-negation-loop, and the judgement loop.
- **Credits:**
  - Damir Sokolovsky for the reference.
  - Erin Catto's Box2D Lite for the accumulated-impulse contact solver.
  - Matthias Müller (Ten Minute Physics, tutorial 18) for the FLIP solver this one ports. It is copied forward from the owner's own fluid experiment.
  - The three.js `webgl_gpgpu_water` example and Evan Wallace's WebGL Water for height-field ripples driven by the cursor; Pavel Dobryakov's WebGL Fluid Simulation for the smooth, falloff-weighted pointer force.
  - Géry Casiez, Nicolas Roussel and Daniel Vogel (2012) for the 1€ filter, whose speed-adaptive cutoff the drawn surface's follower takes.
  - Yongning Zhu and Robert Bridson ("Animating Sand as a Fluid", SIGGRAPH 2005, section 5) for the surface rebuilt from particles; Inigo Quilez for the polynomial smooth minimum that joins it to the body.
  - John Videler and Florian Hess (1984) for the saithe swimming envelope; Videler and Daniel Weihs (1982) for burst-and-coast swimming; Graham Taylor, Robert Nudds and Adrian Thomas (2003) for the Strouhal number of cruising swimmers; Iain Couzin and colleagues (2002) for the zone model of schooling.
  - Pedro Felzenszwalb and Daniel Huttenlocher for the distance transform.
  - Dave Hoskins for the tileable water caustic. He credits joltz0r for the original.
  - Khronos for the PBR Neutral highlight compression.
  - The mulberry32 generator, commonly attributed to Tommy Ettinger (authorship not verified).
  - Type set in Geist (Vercel, SIL Open Font License).
- **Live:** [sunken-404.vercel.app](https://sunken-404.vercel.app). Any missing path on it (/docs/old-page) is served this page with a 404 status.

## Teardown of the reference

- **Opening state:** the digits float with their tops at the surface in water about 1.4 digits deep. The water is teal; colours were measured from the frames:
  - (52, 88, 91) under the surface, (18, 38, 42) at depth;
  - digit faces (149, 175, 171) near the top and (76, 95, 95) lower down;
  - sand (95, 95, 70).
- **Interaction:** "Give the window a shake to stir the water, or fish a digit out and toss it back in". The digits bob, tilt and drift, then return.
- **Life:** clownfish, blue tangs, slender silver fish, red crabs with raised claws, seaweed with alternating leaves (fogged at the back), bubbles, pebbles and shells. A spotlight falls from the top right.
- **Weak spots:**
  - It is a desktop video: nothing shows how it behaves on a phone.
  - The creatures do not seem to react to the visitor.
  - It has sound, which this short leaves out.

## What this piece adds

| Gap | Addition |
|---|---|
| No way back from the 404 | Under one line of copy: Back to home and Get help on a large screen, Back to home alone on a phone. The product's header keeps Log in and Get started (Log in alone on a phone); buttons rise on hover, sink on press and show a focus ring, with hover only on devices that hover |
| Creatures ignore the visitor | Fish dart from a hand moving through the water; crabs raise their claws at a slow hand and scuttle from a fast one; seaweed bends in the current the hand makes; a fast hand trails bubbles |
| Desktop only | A phone layout: the digits take most of the width in deeper water, creatures scale with the tank, touch drags through the water, and tilting the phone sloshes it. A phone on its side gets a tighter headline, clear of the water |
| Static depth | Depth-aware water: what is further back fades into the water and loses red, so the back plants become silhouettes |
| No fallbacks | Reduced motion shows a composed still; without WebGL2 a quiet "404" stands in. Both get copy that does not invite a stir |

## Inspection

- `?stats` shows the frame rate, the physics cost per frame, the particle count and the pixel ratio the governor settled on.
- `?view=mask` draws the water's fill, meniscus and band as red, green and blue.
- `pnpm --filter ./shorts/2026-10-15-sunken-404 test` runs the physics, creature and governor tests; `bench` times one physics step at the desktop and phone layouts.
- `pnpm --filter ./shorts/2026-10-15-sunken-404 phone` builds the short and serves it over HTTPS on the local network with a throwaway certificate, so a phone on the same Wi-Fi can try the tilt (phones report tilt only to secure pages). The phone shows a certificate warning first.
- The Performance timeline carries a `sunken-404:tank-ready` mark when the tank is first drawn.

Performance numbers are lab numbers: headless Chromium on an RTX 3060 Ti through ANGLE D3D11. No real phone has been measured. See `CRITIC-LOG.md` for every pass.
