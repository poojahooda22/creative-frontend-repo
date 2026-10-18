# Critic log

Each pass follows build, render, judge, negate, re-judge. A dimension scores above 8 only when a screenshot or number from that pass proves it. Exit needs a weighted score above 9.0 with no dimension below 9.0.

Weights: concept 1.5, visual craft 1.5, rendering 1.5, motion 1.5, performance 1, responsiveness 1, robustness and access 1, code craft 1, polish 1.

Lab: Windows, NVIDIA RTX 3060 Ti, headless Chromium through ANGLE D3D11.
- **Synced frame times** force a 1×1 `readPixels` after every frame with vsync off, so they are the full CPU plus GPU cost of a frame.
- **Physics times** come from the worker at the normal 60 Hz.
- **Throttling:** Chrome's DevTools CPU throttling applies to pages only ("Operation is only supported for pages, not workers", measured), so the physics worker cannot be throttled.
- **Phones:** no number here was measured on a phone.

## Pass 1: 8.0 before negation

Built before this pass, each from a measured problem:
- **Floating digits.** They stand in water 1.4 digits deep, matching the reference's opening frame. Three causes of instability were found and fixed by tracing the bodies step by step:
  - the surface scan read a void under a digit as the water surface, giving false buoyancy;
  - a glyph is only neutrally stable, so the 4's exposed stem tipped it, which the ballast fixed;
  - Geist's digits are 0.8 of their height wide, not the 0.62 the layout assumed, so the phone 404 touched both walls.
- **Water optics** fitted to colours measured from the reference: water within 4 to 10 levels, sand within 7, digit faces within 10.
- **Life:** fish, crabs, seaweed, stones and bubbles, with 5 behaviour tests. The flee test was checked to fail with fleeing disabled.

| Dimension | Score | Evidence and gaps |
|---|---|---|
| Concept | 8.2 | Every element of the reference plays live; creatures react to the hand; a phone layout. No sound, which the reference has |
| Visual craft | 8.3 | Measured palette; Geist type; composition matched to the reference at 1440×900 and 1920×1080. A dome of water can stand over the digits while stirring |
| Rendering | 8.2 | Depth-aware Beer–Lambert, coverage-aware compositing, caustics traced along the light, a Catmull-Rom surface. Caustics ignore surface orientation; bubbles add light in display space |
| Motion | 8.4 | Bob, splash and return; 3D fish turns, schooling, crab gait; startle. On a phone a digit settles up to 0.1 units (about 28 px) off its slot |
| Performance | 7.5 | Synced 1.44 ms at 1440×900, 2.73 ms at 2880×1800. Physics about 9.5 ms per step at desktop size before the grid was coarsened, 6.0 ms after. No phone measurement |
| Responsiveness | 7.5 | 1440×900, 1920×1080 and 390×844 verified; 4K and 5K not yet rendered |
| Robustness and access | 7.5 | Reduced-motion still, no-WebGL fallback and a clean production console all verified. Context loss untested |
| Code craft | 8.0 | 19 tests, typed modules, casts removed or documented; `scene.ts` at 620 lines mixes input, worker, passes and creature context |
| Polish | 8.0 | A lifted digit sits behind the headline; "Stir the water" shown to visitors who cannot |

Weighted: 8.0.

## Negation round 1: proved junior, 3 major, 11 minor

The negator worked read-only from a fresh context, with web research. Sources it read include:
- Chrome's DevTools blog on throttling;
- Müller's `18-flip.html`;
- Box2D Lite `Arbiter.cpp`;
- Evan Wallace's webgl-water `renderer.js`;
- the Khronos `EXT_multisampled_render_to_texture` text;
- three r183's own source.

| Severity | Finding | Fix, verified |
|---|---|---|
| Major | Phone smoothness rested on page-only CPU throttling, which reaches neither the GPU nor the physics worker; no quality governor | The refresh-aware governor and its tests are copied forward from the liquid glass short. It times frames on the GPU where it can, steps the 3D pass's multisampling 4 → 2 → 0, then the pixel ratio 2 → 1, and steps back up after recovering. Measured: page-only throttling is real ("Operation is only supported for pages, not workers"). Still no phone measured |
| Major | A resize stretched the old tank, then blanked it until the water re-settled; a slow drag never rebuilt at all | The view refits on every resize (sides cropped, never stretched). The old tank stays until the new layout's first state and swaps in the same frame. The rebuild threshold is measured against the built layout. Slow-drag run: no stretch, no blank, clean console |
| Major | Instanced meshes never freed their instance buffers | `mesh.dispose()` in fish, plants and pebbles |
| Minor | Bubbles added linear light to sRGB-encoded pixels | Bubbles draw into a one-byte target the composite adds in linear light, before highlight compression |
| Minor | Contacts clamped per pass, not accumulated | Contacts are collected once per step; normal and friction impulses accumulate and are clamped as totals, as in Box2D Lite; 8 passes |
| Minor | A grab could miss in the worker while the page kept holding | The worker echoes the last press it handled; a miss releases the page's hold. Hit tests use the drawn pose |
| Minor | Worker buffer pool kept dead sizes after a rebuild | Cleared on `init` |
| Minor | Spray pass splatted every particle | Particles deeper than 0.25 units under the surface are culled in the vertex shader |
| Minor | Caustics ignored the simulated surface | The surface's curvature where the light enters focuses or spreads them; they are also weighted by how the surface faces the light, from screen-space depth slopes |
| Minor | Targets rounded instead of matching three's floored drawing buffer | Sized from `getDrawingBufferSize` |
| Minor | A context lost for good left a dead canvas | It falls back to the still page after 3 s. Measured: fallback shown, still-page copy |
| Minor | Reduced-motion still waited for 5 s of settle | 2.5 s, and the layout is announced before settling |
| Minor | Dead grid copy, an overclaiming comment, a cast instead of worker types, a wall-clock unit test | Copy removed; comment fixed; the worker compiles in its own program with the WebWorker library; the rasteriser moved to the page; timing moved to `pnpm bench` |
| Minor | Drift compensation averaged in solid and air cells | Fluid cells only. Phone layout packs 3.6% instead of 4.8%; rest agitation unchanged |
| Unverified | Multisampled render-to-texture with a depth texture on tile GPUs | Where the browser offers `WEBGL_multisampled_render_to_texture`, the 3D pass does not multisample. three's own source says the extension misbehaves with an external depth buffer |

Also found and fixed during the round:
- A lifted digit dragged a column of water up after it. The solid boundary is now separating: water may not flow into a solid but may leave it.
- Startup overlapped. The environment map bakes while the worker settles, and the tank's shaders compile in parallel. First drawn tank: 2.15 s, now 1.45 s.
- The tank fades in.
- The headline steps back while a digit is held.
- Page type scales with height on large screens.

## Pass 2: 8.66

| Dimension | Score | Evidence and gaps |
|---|---|---|
| Concept | 8.5 | The reference's elements plus creatures that react to the hand, a phone layout, and depth-aware water. No sound, which the reference has |
| Visual craft | 8.7 | Display matrix rendered (3840×2160, 2560×1440 at 2×, 1512×982 at 2×, 2560×1080, 1920×1080, 768×1024 at 2×, 390×844 at 2×): all compose. A dome of water can stand over the digits mid-stir; the caption sits on the sand the crabs walk |
| Rendering | 8.8 | Depth-aware optics; coverage-aware compositing; caustics weighted by facing and focused by the simulated surface; bubbles in linear light; spray only where thrown; soft reveal |
| Motion | 8.7 | Separating boundary (clean lift, no dragged column); accumulated contacts; a toss of the 0 splashes, sinks and bobs back into "404" within 5 s. On a phone a digit can sit up to 0.12 digit heights off its slot while the water settles |
| Performance | 8.0 | Synced frames: 1.44 ms at 1440×900, 2.59 ms at 2880×1800. Physics: 5.9 ms per step at desktop size, 3.9 ms at phone size (`pnpm bench`, p99 7.4 ms). First drawn tank at 1.45 s, text at 0.22 s. The governor keeps pixel ratio 2 here. No phone measurement |
| Responsiveness | 9.0 | Matrix above; slow-drag resize with no stretch or blank |
| Robustness and access | 8.8 | Reduced-motion still and no-WebGL fallback, each with its own copy. Context loss and restore tested with motion and as a still. A context lost for good falls back. Clean production console |
| Code craft | 8.8 | 25 tests plus a benchmark; the worker in its own WebWorker-typed program with a DOM-free simulation; input in its own module; no casts outside one test stand-in |
| Polish | 8.6 | Reveal, headline step-back, copy for still visitors. Caption over the crabs' sand |

Weighted: 8.66.

## Pass 3: 8.79 before negation

Built since pass 2, each from a problem the owner raised or a measurement found:

- **Fish that swim like fish.** The old fish crawled at a median 0.60 body lengths a second. The rewrite takes its numbers from fish biomechanics (credited in `SHORT.md`): a body wave whose amplitude grows toward the tail, a tail beat tied to speed, pectoral rowing for clownfish and tangs, burst-and-coast for minnows, schooling zones, and a critically damped turn. Turns had zigzagged (2.1 reversals a second, an underdamped loop) and fish had dithered out of the tank near a half turn; both were traced and fixed.
- **Still water that is still.** Measured at 1440×900 with the water left alone:

  | Measure | Before | After |
  |---|---|---|
  | Physics surface, standard deviation | 3.86 px | 2.10 px |
  | Open water, standard deviation | 3.03 px | 1.57 px |
  | Drawn surface, change per frame | 0.948 px | 0.090 px |
  | Drawn surface, bumpiness | 0.418 px | 0.132 px |
  | Calm (1 is still) | 0.64 | 0.90 |

  The resting noise was low-frequency, so a 1€ filter did nothing; the cause was the digits pumping the water. Damping their heave and roll once calm, a FLIP blend that slides toward PIC as the water calms, and a render-only smoothing with a slow swell fixed it.
- **Tilt on phones.** The phone's tilt turns the tank's gravity; a shake splashes it; iOS asks first from a chip. Checked with synthetic sensor events in portrait and landscape (screen angle 90), and with a stand-in for Safari's permission that allows, denies and throws.
- **Particle budget.** Measured per step on the lab CPU (Node, same V8):

  | View | Before | After |
  |---|---|---|
  | 844×390 phone, landscape | 11,382 particles, 7.05 ms | 4,642, 2.98 ms |
  | 390×844 phone, portrait | 5,775, 3.87 ms | Unchanged: held at 13 cells per digit (the 0.3 ms between runs is noise) |
  | 3440×1440 | 12,806, 7.73 ms | 8,562, 5.14 ms |
  | 1440×900 | 7,843, 5.20 ms | Unchanged: within budget |

  Forced to run slow, the worker rebuilt a 1440×900 tank at 3,163 particles before its first frame, 130 ms later than usual.
- **Level digits.** Both 4s rested about 0.11 rad clockwise: more of the 4 stands above the water on its right, so the water lifts it off-centre. A trimmed ballast floats them level (within 0.04 rad; the test fails at 0.106 with the trim off).
- **A phone on its side.** The headline ended about 12 px above the digits at 844×390 (read off a screenshot), and a slosh ran the water into it. Short landscape views now get a tighter headline on one line: 77 px clear.
- **One source for the grid.** The page derived the solver's cell size and particle radius again from the layout, 0.4% off the solver's real cell; it now takes both from the worker.

Evidence:
- **Tests:** 31 pass. The tilt, trim and budget tests were each checked to fail with their fix disabled.
- **Fish (desktop):** median speed 1.61 body lengths a second, median tail beat 2.6 Hz, nearest neighbour 0.77 body lengths, schools 4.8 times wider than tall, no fish leaving the tank at desktop or phone size, 0.65 to 0.97 visible reversals a second.
- **Tilt (390×844, held 0.34 rad):** the surface's slope, averaged over the slosh, sits within 0.05 rad of the tilt; the digits float within 0.06 rad of level with it; upright again, the water's mean slope is under 0.02 rad.
- **Responsive matrix:** 20 views from 320×568 to 3840×2160, both phone orientations. No page scroll on either axis, no console errors or warnings, and the headline clear of the digits everywhere. The matrix ran on the development build, with Direct3D's precision notes on three's own shaders filtered out; the production build does not ask for shader logs. The tightest gap is 27 px at 320×568.
- **Synced frame times (production build):**

  | View | Mean | p99 |
  |---|---|---|
  | 1440×900 | 1.71 ms | 3.00 ms |
  | 2880×1800 | 2.53 ms | 3.30 ms |
  | 3440×1440 | 2.62 ms | 3.80 ms |
  | 3840×2160 | 3.69 ms | 5.10 ms |
  | 390×844 at pixel ratio 2 | 1.78 ms | 3.50 ms |
  | 844×390 at pixel ratio 2 | 1.50 ms | 2.40 ms |
  | 390×844, page CPU throttled 4× | 4.39 ms | 9.80 ms |

  The worker is not throttled; see the lab note above.

| Dimension | Score | Evidence and gaps |
|---|---|---|
| Concept | 8.7 | Tilt makes the phone version its own interaction, the reference's biggest gap. No sound, which the reference has |
| Visual craft | 8.8 | Level digits; the landscape headline; the tilt chip matches the caption. Portrait phones keep a dark band of air above the tank, as the reference does |
| Rendering | 8.8 | Unchanged this pass |
| Motion | 8.9 | Fish and still water measured above; the tilted water levels with the world and the digits, seaweed and bubbles follow it. Fish keep level with the screen, not the tilted water. A big tilt in a wide tank sloshes for several seconds, as a real tank would |
| Performance | 8.2 | Budgets and the slow-device rebuild measured above. Still no phone measured: phone GPUs are the unknown, and portrait phones sit at the grid's floor, so a slow phone has nothing left to shed there |
| Responsiveness | 9.1 | The 20-view matrix; tilt in both orientations; the landscape fix |
| Robustness and access | 8.9 | Permission allowed, denied and throwing; sensor events before permission ignored; tilt only on secure pages and never with reduced motion. No real iOS or Android device tested |
| Code craft | 8.9 | 31 tests, the new ones mutation-checked; grid size and particle radius from one source. `scene.ts` keeps growing |
| Polish | 8.8 | The invitation follows the device: cursor, drag or tilt |

Weighted: 8.79.

## Pass 4: the water, 8.85 before negation

The owner's report: the water formed tall jittery "layers" when a digit was dragged, reaching the top of the view; the cursor barely moved it; fish could hang outside it. Measured first, with a probe running the real physics and scoring the drawn surface. The digit was dragged hard through the water in a loop at 1440×900:

| Measure | Before | After |
|---|---|---|
| Drawn water against the water simulated | 1.48 | 1.05 |
| Highest drawn water, share of the view | 100% | 62% |
| Frame-to-frame jitter (second difference in time) | 17.5 px | 0.28 px |
| Roughness across columns | 5.9 px | 0.85 px |
| Steepest slope | 1.47 rad | 1.21 rad |
| Water drawn as spray above the line, peak | 5.7% | 1.4% |
| Slosh left a second after letting go (first measured midway, after the surface fix) | 52 px | 18 px |

Causes found and fixed, in the order the measurements led:
- **The surface read the highest particle run, not the water.** Churned, aerated water and sheets thrown above an air gap were filled down to the floor as solid water: the "mountains". The surface is now the height the column's water volume fills, from the floor to the first air gap; thrown water is spray. Two side problems surfaced and were fixed at their root:
  - **An uneven fill.** The initial fill left all its spare width at the right wall, whose column stayed half empty for good. The lattice is now centred.
  - **The walls.** Particles keep a radius off the glass, so the surface meets each wall at its neighbour's height.
- **The digits were pistons.** A 2D solid digit is a wall through the whole depth of the tank. Dragged, it shoved every drop ahead of it up the glass; at rest its bobbing pumped waves. A real digit is a thin slab the water flows around. The digits are now open to the water and pull the water inside their outline toward their own velocity (Brinkman penalization, before the pressure solve). With every other setting the same, this one change took the hard drag from 95% of the view to 58%, and the spray peak from 6.7% to 0.4%; capping speeds alone had not brought them down.
- **Smoothing that switched on and off.** The drawn surface was smoothed only while calm, so still water answered the cursor late and churned water showed raw. It is now filtered the same way always: a Gaussian across columns, and a critically damped follower in time.
- **Too much energy.** Water may move at most 4.5 units a second (it ran a wave to the top of the view at 9). It is damped 0.9 a second, which stands in for the losses a 3D tank has. A held digit moves through water at most 2 units a second from first contact (the water then peaks at 62% of the view, against 72% at 3 units a second).
- **A cursor that barely moved the water.** The stir now reaches 0.3 units (was 0.2): a sweep under the surface moves it 17 px RMS (was 13.5), a deeper one 13 px (was 5.7). A ripple layer, a damped wave equation as in three.js's `webgl_gpgpu_water` and Evan Wallace's WebGL Water, answers a cursor through or just over the surface with ripples of 15 to 17 px on a desktop (6 px from a phone finger just above the water).
- **Spray drawn twice.** Fast particles just above the line were drawn as a second, grey layer. Spray is now only water lifted clear.
- **Fish out of water.** Steering alone could not keep up with a falling trough. Each fish is now kept under the drawn surface.

Evidence:
- **Tests:** 34 pass. The three new ones each fail without their fix:
  - the drag test: the old code broke three of its bars by the numbers above (water drawn, height reached, jitter);
  - the ripple test reads 1.5 px of curvature with the ripples off, against a bar of 2.4 (3.4 px with them);
  - the fish test leaves a fish 0.38 units above the water without its clamp.
- **At rest:** jitter 0.02 px, roughness 0.18 px (1440×900); 0.05 px and 0.06 px on a phone.
- **After a hard drag:** every digit is back near its slot about 5 s after letting go and settled by 9 s. Each sits up to 0.08 digit heights high while the churned water still holds air.
- **Cost per physics step:** 5.55 ms at 1440×900 (9,860 particles, up from 7,843 since the water now fills the digits' outlines too); 3.72 ms at 390×844. The production build runs at 60 fps with a clean console at both sizes.
- **Screenshots:** a hard drag shows one smooth wave and no second layer; a phone drag the same. The fish stay under the surface.

| Dimension | Score | Evidence and gaps |
|---|---|---|
| Concept | 8.7 | Unchanged |
| Visual craft | 8.9 | One body of water with one edge; spray only where water is thrown |
| Rendering | 8.9 | The double layer is gone. The ripple layer is non-dispersive: every ripple travels at one speed, a stylisation |
| Motion | 9.0 | Measurements above; water and digits return calm. Digits float slightly high after a hard stir until the water compacts |
| Performance | 8.2 | Step cost up 10% with the extra particles; still no phone measured |
| Responsiveness | 9.1 | Unchanged |
| Robustness and access | 9.0 | Fish can no longer leave the water; the hard-drag case is bounded |
| Code craft | 9.0 | One root cause (digits as pistons) fixed in place of piled-up limits; the sealed-pocket venting it needed is gone; 34 tests |
| Polish | 8.8 | Unchanged |

Weighted: 8.85. A negation round on the water is running.

## Pass 5: pace

The owner: the water is smooth now but too slow, and hard to move. Checked in the browser first. The physics ran in real time (60 steps a second, 7 ms each), so this was not lag. A cursor sweep, filmed every 150 ms, showed a bow wave that rolled slowly for seconds after the cursor left. The tank was 3 units tall with gravity at 9.81 units/s², so its water moved like a 3 m pool's.

- **Pace.** The tank now runs 1.4 times faster: gravity is scaled by 1.4², and every speed and rate in the water and the digits by 1.4 (`PACE` in `flip.ts`). Splashes reach the same heights in 1/1.4 of the time. At a pace of 1 the refactor reproduces the earlier numbers exactly. The surface follower was left at its old speed: a faster one let more of the resting noise through.
- **Loosened water.** At the new pace a skimming cursor left the surface 7.7 px high, with a 20 px hump that never went away. Drift compensation pushed compressed water out but never drew loosened water back in, so stirred water stayed fluffy (the same flaw that floated the digits high after a stir). Deep cells, where the cell and its eight neighbours hold water, are now drawn back in. The surface returns within about 5 px (5.6 at worst) and its mean within 1 px. The ripple test's bar was tightened to 10 px; with the correction off it reads 18.9 px.

| Measure (1440×900) | Pass 4 | Pass 5 |
|---|---|---|
| Surface movement while a cursor sweeps under it | 15.2 px RMS | 19.4 px RMS |
| Time for the water to answer | 0.20 s | 0.15 s |
| Still again after the cursor leaves (mostly the loosened-water fix) | over 4.3 s | 2.05 s |
| Hard drag: highest water, spray peak, jitter | 62%, 1.4%, 0.28 px | 61%, 2.1%, 0.38 px |
| Still water, change per frame | 0.058 px | 0.124 px |

34 tests pass. The production build runs at 60 fps with a clean console at 1440×900 and 390×844. The film of the sweep shows the bow wave reaching the far glass sooner and the water flat by 1.8 s, where before it still undulated at 2.25 s.

Motion rises to 9.1. Still water is a little busier (0.12 px a frame, far under a pixel). Weighted: 8.86. The negation round started in pass 4 is still running against the pass-4 code.

## Negation round 2: proved junior, 4 major, 4 minor

The negator worked read-only from a fresh context against the pass-4 water (the pass-5 pace landed mid-round; its numbers came from a frozen copy), with web research: Müller's `18-flip.html` at the commit, Evan Wallace's `water.js`, three r183's `webgl_gpgpu_water`, Pavel Dobryakov's `script.js`, Verma et al. on penalization, Carlson, Mucha and Turk's Rigid Fluid, Casiez, Roussel and Vogel's 1€ filter, and a sloshing-damping paper.

| Severity | Finding | Fix, verified |
|---|---|---|
| Major | The "thin slab" coupling pulled the water inside a digit to the digit within three steps (near-solid), handed nothing back, and absorbed most of the cursor's stir (a sweep moved the surface 19.8 px with it, 40.9 without) | The premise was wrong: the reference's digits shove water as solids. The digits are solid again, with the separating boundary and venting; the cursor's sweep now moves the surface 31 to 35 px RMS. A two-way version was tried and measured first: it handed each digit the weight of the ghost water inside its outline, so they sat low and listed |
| Major | A lifted digit carried a slug of water up again (263 px above the line), a bug round 1 had fixed | The part of a digit above the water line is open to the grid: a lifted 0 leaves its counter's water behind (36 particles at most above the line, from 195; none visible in the film) |
| Major | The fixed-rate surface follower trailed a hard drag by up to 72 px, and the water above the lagging line was drawn as a second layer of spray | A 1€-style follower (10 rad/s at rest, up to 120 as it trails), stepped in closed form. Stepped explicitly it diverged past 50 rad/s: needles, then black bars down the page, which the owner hit and which a test now reproduces. Lag at most 46 px in the hardest frame of a 4 units/s loop; 1% of the drawn line's moves reverse direction, against 8% in the reference's own water at 60 fps |
| Major | The speed cap never engaged, and the damping comment's numbers did not reproduce | Cap deleted. Damping re-measured over drags at three speeds and checked against the reference's decay, whose waves keep a fifth of the frame for seconds after a splash |
| Minor | The coupling overrode the glass and sand boundary | Gone with the coupling |
| Minor | The fish test checked centres, not fish | Every corner of each fish's box, as drawn, stays under the surface. The clamp runs only while swimming: at birth it had sent every fish under the sand, which the owner saw |
| Minor | A portrait phone ran over its particle budget | The grid floors at 9 cells per digit instead of 13; 4,490 particles at 390×844 |
| Minor | The surface docstring overclaimed "air squeezed out" | Rewritten: cells at 60% of rest density count as full, and why |

Found while fixing, not by the round:
- The pace as stronger gravity packed the particle lattice harder each step: the resting jostle rose seven times (0.005 to 0.035), calm never engaged, the undamped digits rocked and kept it up. The pace is now a faster clock with the solver's own gravity and step (84 steps a second, 40% more worker time).
- The digits' settling damping waited for calm; it now acts on slow heave and roll regardless and fades for fast motion.

## Pass 6: judged against the reference

The owner asked for the water to be judged against Damir's post, not against our own earlier passes. Frames were pulled from the reference video (a digit drag at 14.5 to 17.5 s at 8 fps, one second at 60 fps, the decay after its splash at 16 s) and its water line measured with the same script as ours: the line's speed, its crest-to-trough per frame, and the share of its moves that reverse direction the next frame.

| Measure, a hard digit drag at 1440×900 | Reference | Ours |
|---|---|---|
| Water line speed, median | 0.18 views/s | 0.21 |
| Water line speed, 90th percentile | 0.49 | 0.87 |
| Crest to trough per frame, median | 0.22 of the view | 0.15 to 0.25 (runs differ) |
| Moves reversing direction the next frame | 8% | 1% |
| Crest to trough a second after a splash | 0.13 to 0.19 | about 0.18 |

| Criterion (the owner's list) | Score | Evidence | Short of 9 because |
|---|---|---|---|
| Fluid simulation | 9.0 | FLIP/PIC with incompressibility; the drawn water within 10% of the tank's through a hard drag (5% measured in pass 4); solid moving bodies with a separating boundary and venting; stable under a cursor whipped at the speed cap for ten seconds; resting noise 0.005 with calm at 0.94 | |
| Water | 9.1 | Rest 0.25 px a frame; a sweep moves the surface 31 to 35 px; a drag within the reference's range; sloshing persists as the reference's does; a lifted 0 carries nothing; a toss splashes like the reference's drop at 7.5 s | |
| three.js | 9.0 | r183, MSAA half-float target with depth, depth-aware composite, instanced creatures, disposal, governor, async compile, context loss handled (passes 2 and 3); the edge and meniscus now follow the surface's normal | |
| Photo (the still) | 9.0 | Colours measured from the reference; thrown water drawn light; steep faces draw as faces | |
| Photorealistic fluidity | 8.9 | 1% reversals against the reference's 8%; no lag; 84 physics steps a second, drawn between steps | Thrown sheets are particle splats with hard edges where the reference's are rounder blobs; a density-field body would fix it |
| Scalability | 9.1 | 20 views from 320×568 to 3840×2160: no scroll, clean console, headline clear of the digits; budgets per device; the worker rebuilds smaller when its first frames run slow | |
| Performance | 8.7 | 60 fps at every size; synced frames 2.63 ms at 2880×1800 (p99 3.8), 1.37 ms at phone size; the worker 9.6 ms a frame at 1440×900, 6.2 at phone size | No real phone measured; the faster clock costs the worker 40% more, 9.6 of its 16.7 ms on this desktop |
| Premium feel of the cursor | 9.0 | Answers in 0.15 s; ripples of 15 to 17 px from a skim; a sweep moves the water 31 to 35 px; no reversal jitter | The reference has no cursor stir to compare against |
| Realism against the original | 9.0 | The table above; the same family of jagged splashes, sheets and drops, water piled ahead of a dragged digit, digits riding waves | The line's fast tail is faster than the reference's (0.87 against 0.49 views/s) |

No bug, no jitter: 36 tests pass, and the needle collapse, the fish leaving the water, the unstable follower and the fluffy water each have a test that fails on the old code. The production build is clean at 20 sizes. Still water changes 0.25 px a frame. The headline dims in 0.45 s when a digit is held and never moves. One behaviour that is not a bug: a digit re-entering at full speed can throw a fifth of the particles in one splash, as the reference's drop does.

| Dimension | Score |
|---|---|
| Concept | 8.7 |
| Visual craft | 9.0 |
| Rendering | 9.0 |
| Motion | 9.1 |
| Performance | 8.7 |
| Responsiveness | 9.1 |
| Robustness and access | 9.0 |
| Code craft | 9.0 |
| Polish | 8.8 |

Weighted: 8.94, not yet the exit (above 9.0 with no dimension below 9.0). Two of the owner's criteria sit under 9: performance until a phone is measured, and photorealistic fluidity until thrown water is drawn from a density field. No negation round has run against pass 6.

### Pass 6, one fluid

The owner's screenshot after pass 6: sheets thrown by a hard stir drawn as a second material, light and flat, with a dark gap under the ones rising straight out of the body. Two causes in the composite. Thrown water was drawn only 1.5 to 3 cells above the line, which cut the gap under every rising sheet, and it was coloured lighter than the body. Now water above the line is drawn wherever the particles are dense enough to be water (a threshold above the resting top layer's thin halo keeps the resting edge the smooth line), in the body's own colour with a thin light rim, and the meniscus is left off where the water carries on above the line, so a loose crest no longer reads as a skin lying on the wave. Filmed: a hard drag and a toss show one fluid with rims where Damir's has them; the resting line and a cursor sweep are unchanged; console clean; production build clean.

Visual craft and rendering rise to 9.1; on the owner's list, photo to 9.1 and photorealistic fluidity to 9.0 (the sheets are the body's water now; their edges are still particle splats). Weighted 9.0, not the exit while performance sits at 8.7 without a phone measured.

### Pass 6, the water's top

The owner's third screenshot: a wedge of lighter water sitting in a V in the drawn line, with a dark gap beside it. A pocket of air trapped in the sloshing water had stopped the per-column volume scan, so the line dived to the pocket's floor and the real water above it was drawn by the particle path, shaded as surface water with its own edge. A height field cannot hold water folded over air; the reference's blob rendering can.

A second line per column, the top of its water (the highest run of three fluid cells, smoothed and followed as the volume line is), now travels to the composite in the surface texture's second row. Wherever it stands clear above the volume line, the water between the two takes the body's shade measured from that top, on both sides of the volume line (measured from the line on one side and the top on the other, the shade jumped at the line under every wave); aerated water between them is drawn at a lower density threshold (it drew as dark smears inside a crest); and the meniscus moves up to the top, each line carrying its own weight (blending one distance between them drew a second, fainter line on a loose crest). Filmed at 1:1 on a hard cursor whip, a toss and a drag: one edge at the real top, continuous shade into the body, thrown sheets in the body's teal with a light rim; the resting line unchanged; console clean. Production: synced frames 2.62 ms at 2880×1800 (p99 3.5), 1.45 ms at phone size; the worker 8.9 ms a frame at 1440×900.

### Pass 7, one field

The owner's fourth screenshot: the meniscus floating over open air, wide, with dark masses of water above it and the water's edge somewhere else. Pass 6's two fixes had patched the same flaw twice. The water's fill came from one source (the volume line plus a density threshold for spray) and its meniscus from others (the volume line, then a second "top" line), reconciled by heuristics. Wherever the water stopped being a height field (a fold, a pocket of air, an aerated crest) the line and the fill disagreed, and each patch moved the seam rather than removing it.

The fill and the meniscus now come from one signed distance field, so they cannot part. Below the volume line it is the distance to that line; above it, Zhu and Bridson's particle surface (SIGGRAPH 2005, section 5: the distance to the kernel-weighted mean of the particles within twice their spacing, less a particle's radius), read from splats of four plain sums; a polynomial smooth minimum joins the two. The edge is measured against the field's own per-pixel gradient, which keeps the meniscus one width where the field is shallow; before that, the union and the particles' concave corners drew it wide. Still water is held flat by sinking slow particles near the line under it, per particle in the worker (World.drawnParticles). A first version shrank them instead, and settling water thinned to salt-like specks along the surface. Particles at rest inside a digit's open top are not drawn.

Findings on the way, each fixed:
- The particles' own surface at rest is not the volume line: ±8 px about it in open water and up to 19 px above it beside the digits (probed at 1440×900). A plain union put particle jitter on still water.
- three's AdditiveBlending without premultiplied alpha is SRC_ALPHA, ONE (WebGLState.js), so the splats' sums were weighted by the speed written to alpha. Custom ONE, ONE blending now.
- The meniscus pixels the line-on-edge metric first flagged were the page's own headline over the canvas; the mask harness hides the page text.

Measured (1440×900, hard cursor whip, toss and drag, 16 mask frames; `?view=mask`):
- Line on an edge (water and dry both within 3 px): 98.5% of meniscus pixels. The rest are sub-2-px air gaps inside churning water and sub-pixel drops; none is a line beside the water.
- Edges with a line: 99.997%.
- Phone size (390×844 drag): 99.5% and 100%.
- Still water (a test reads the drawn field off the same particles the worker sends): its edge is the volume line in every column-frame. The only departure is one particle sliding off a digit's crossbar at 0.6 to 0.7 units/s, in 3 of 2,240 column-frames. With the sink disabled, 653 departures in still water; the shrink-margin version, disabled, 1,279.
- Tests: 38 of 38 pass.
- Production: synced frames 2.64 ms at 2880×1800 (p99 3.6) and 1.46 ms at phone size; worker 8.5 ms a frame at 1440×900, 5.5 ms at 390×844; 60 fps; console clean.

Against the reference at 14.75 s, which draws a pocket of air under its 4 as a hole with a bright rim and its top as a thin line on the water's edge, this draws the same. The old renderer could not draw the pocket at all.

| Owner's list | Score | Why |
|---|---|---|
| Fluid simulation | 9.0 | Solver unchanged; the drawing now shows what it does (pockets, sheets, drops). |
| Water properties | 9.2 | One material, one meniscus on every edge, shade continuous through every shape. |
| Three.js / WebGL | 9.1 | One splat pass with exact sums, a gradient-measured edge, no added passes; a blend-mode bug of this pass's own making was caught by measurement. |
| Photo | 9.2 | Matches the reference's blob-and-rim look in stills. Small slivers in foam remain. |
| Photorealistic fluidity | 9.2 | Sheets, arcs and drops follow the particles; settling water sinks into the line. |
| Scalability | 9.1 | Unchanged. |
| Performance | 8.7 | Unchanged lab numbers; still no real phone measured. |
| Cursor feel | 9.0 | Unchanged. |
| Realistic water movement | 9.1 | The motion was there; the drawing no longer hides or misplaces it. |

Weighted 9.1, but not the exit: performance stays under 9 until a phone is measured.

Open:
- Water climbing the side glass draws as a strip a pixel or two off the screen edge (the particles keep a radius off the glass; the field has no ghost particles past the walls).
- Air gaps under 2 px inside churning water draw as tiny bright slivers.

### Pass 8, a product's 404

The owner asked for the page to read as any product's 404, with the header and copy in that context, premium and product-ready, and for less text under the heading.

Studied first, in a browser, on 2026-10-18: the live 404 pages of 20 product sites, at 1440×900, and their buttons as an iPhone sees them, at 390×844. Most keep their own header with its Log in and sign-up buttons (Figma, Framer, Stripe, GitHub, Apple, Spotify). The strongest say what happened in one sentence (Arc: 8 words in the first screen; Apple 15; GitHub 18; Supabase and Webflow 20) and let one interaction carry the brand (Figma's draggable vector 404, Dribbble's colour slider, GitHub's Octocat). The link dumps (Mailchimp at 127 words, Airbnb's and Dropbox's link lists) are the dated pattern. On phones, the best primary buttons measured 44 to 46 px tall (Figma 46, Webflow 46, Arc 45, Stripe 44); the weakest 29 to 34 (Framer, Supabase).

Changed to match:
- The header is a product's own: Product, Pricing, Docs and Changelog; a quiet Log in and a solid Get started with an arrow that leans on hover.
- The hero is the heading, one line and two buttons, with the water's invitation in a chip at the foot.
- On a phone there is one prominent button per view, as Apple's guidelines ask: Log in alone in the header, Back to home alone in the hero.
- Sizes on phones come from primary sources:
  - Apple's typography and button pages: Large Title 34/41, Title 1 28/34, Body 17/22, Subhead 15/20; a 44 pt hit region; a 52 pt Large capsule.
  - Material 3's Compose tokens: buttons 40 dp default and 56 dp medium with 24 dp sides, 58 dp minimum width; a 48 dp minimum interactive size; Display Small 36/44, Body Large 16/24.
- Two bugs caught by looking:
  - A `.nav a { color: inherit }` rule outranked the solid button's text colour, so Get started rendered as a blank cream pill.
  - The buttons were content-box sized, so a 12 rem minimum width came out at 240 px. The sizing is now explicit.

The spotlight came straight down through the headline (12.5° from vertical, entering at 0.55 of the width). The reference's falls from the top right between the headline and the header's buttons: 35° and 38.5° in two frames, entering at 0.74 and 0.76, measured from the beam's centre row by row with the text masked. Now 36.5° entering at 0.75, from one constant shared by the scene and the shader, measured back at 37.0° and 36.8° entering at 0.758 and 0.751. The digits' key light moved with it. The reference's beam stays brighter: 43 levels over the page against 22.

Checked:
- 20 sizes from 320×568 to 3840×2160: no overlap with the digits, no sideways scroll, console clean.
- On phones as an iPhone: Log in 44 px; Back to home 240×52 with a 17 px label (48 on short phones, 44 on its side); the heading one line at 34 px (28 on short phones); the line under it 17 px on two lines.
- Button states at 2×: rest, hover, keyboard focus, press.
