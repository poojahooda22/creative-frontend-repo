# Critic log

Each pass follows build, render, judge, negate, re-judge. A dimension scores above 8 only when a screenshot or number from that pass proves it. Exit needs a weighted score above 9.0 with no dimension below 9.0.

Weights: concept 1.5, visual craft 1.5, rendering 1.5, motion 1.5, performance 1, responsiveness 1, robustness and access 1, code craft 1, polish 1.

Lab: Windows, NVIDIA RTX 3060 Ti, Chromium 151 headless, ANGLE D3D11. "Synced" frame times force a 1x1 `readPixels` after every frame with vsync off, so they are the full CPU plus GPU cost of a frame. No number here was measured on a phone.

## Pass 1: 8.38 before negation, 7.6 after

| Dimension | Score | Evidence and gaps |
|---|---|---|
| Concept | 8.6 | Every beat of the reference plays live, plus hover tilt, a light that follows the pointer, press dent and squash, and labels that size their pill. Frame pairs at 1.0, 2.0, 3.6, 4.4, 5.2, 7.0 and 8.4 s |
| Visual craft | 8.3 | Palette measured from the reference (#d6deed, warming to #d4ccde); Geist type; the drops read slightly frosted against the reference's crystal ones |
| Rendering | 8.2 | Refraction, Fresnel exits through total internal reflection, dispersion, absorption and analytic coverage anti-aliasing; faint straight refraction lines in the neck; crown chunkier than the reference |
| Motion | 8.5 | Analytic timeline timed from the reference at 4 fps; impulses ring and decay; the swipe merge, pinch-off beads and crown all verified by frame strips |
| Performance | 7.5 | Synced 1080p mean 2.64 ms; splash 8.0 ms before culling, 4.0 ms after. Cold shader ready 4.3 s, cut to 1.7 s. No phone measurement |
| Responsiveness | 9.0 | 4K, iMac 5K, MacBook Pro 14", 1080p and phone renders all compose; no overflow at 390 px |
| Robustness and access | 8.5 | Keyboard, reduced motion, no-WebGL fallback and phone tap checked through console output and labels |
| Code craft | 8.5 | Typed modules and a pure cycle; no unit tests at first; three.js removed |
| Polish | 8.3 | Caption tiny on 4K at 1x; hit box sized from the depth corners |

Built during pass 1: three.js replaced by raw WebGL2 (bundle 205 KB to 84 KB gzip). Shader restructured to one `map()` and one `lookup()` call site with non-foldable loop starts (cold compile 4286 ms to 1324 ms in a synchronous link). Per-segment droplet culling (splash 8.0 ms to 4.0 ms). Inner-march start fixed (concentric rings at phone distance). Unit tests for the cycle and motion helpers; the first run caught a real pop: a click at 8.6 to 8.9 s jumped the camera 0.6 degrees, fixed by moving rest to 9.0 s.

## Negation round 1: proved junior, 1 critical, 5 major, 4 minor

| Severity | Finding | Evidence | Fix, verified |
|---|---|---|---|
| Critical | The reduced-motion still was blank: the only render ran before the shader linked | Non-backdrop pixels 0.0000 at 1, 3 and 6 s against 0.2144 for the control; MDN on `KHR_parallel_shader_compile` | The still redraws every frame until the scene reports ready, also after context restore. Screenshot assertion: glass fraction 0.120 |
| Major | A press dragged off the pill stuck | 24.4% of the button's pixels changed 2.5 s after release; MDN `setPointerCapture`; React Aria `usePress` | Pointer capture, and a release outside cancels the click. After drag-off 0.048% changed |
| Major | WCAG 2.2.2: no way to pause, and the focused button's name changed every 10 s | W3C Understanding 2.2.2 | A visible Pause control (44 px, `aria-pressed`, hidden under reduced motion); the cycle holds while the button is focused. Pause: 0.000% changed over 1.5 s; focused name held for 12 s |
| Major | The governor read a 30 Hz refresh cap as GPU overload | WebKit bug 215745; Chrome Energy Saver post; drei `PerformanceMonitor` | `governor.ts`: refresh-aware budget floored at 60 fps, GPU timer queries where available, step-up with a flip-flop guard. Seven unit tests, including the 30 Hz cap and a 144 Hz display |
| Major | The hit target went stale on label change | Probe: 18% too tall for two of three labels | Layout reported on every label change (fixed during the round) |
| Major | SHORT.md blank, credits missing | CLAUDE.md requires credits | Written; credits checked against IQ's normals page and the mulberry32 sources |
| Minor | The crown SDF was not Lipschitz-bounded | Striations in a zoomed crown | Local slope bound applied beyond the smooth-union reach (applying it inside the reach inflated the crown; caught in the 7.0 s frame); `atan(0, 0)` guarded |
| Minor | Lookup arrays may spill to local memory on phone GPUs | NVIDIA Nsight guidance | Not measured: no phone or Mali Offline Compiler here |
| Minor | Pixel ratio and reduced-motion preference read once | MDN `devicePixelRatio` | Both followed live through `matchMedia` |
| Minor | Dead `uPivot`, benchmark history in comments | Code read | Removed |

Also fixed during the round: the WebGL context is released on dispose; the frosted drop rims (the studio now darkens and cools away from the view axis, where rim rays exit); the 4K caption scales with the viewport.

## Negation round 2: proved junior, 4 major, 4 minor

| Severity | Finding | Fix, verified |
|---|---|---|
| Major | The crown fingers tunnelled: the slope bound did not cover the region where the fingers are. A tiny-step render showed the true, smooth fingers | The crown rebuilt from exact distances: a torus collar plus seven round-cone fingers with beads, by polar repetition (own sector and nearer neighbour). Per-finger length, lean and offset from a sector hash so it reads as liquid |
| Major | After a context restore the timer extension was gone, flooding the console | The extension is requested again on restore. Assertion: glass redrawn, console noise 0 |
| Major | Pause control announced "Play, pressed" while paused | Fixed label "Pause" with `aria-pressed`, and a pressed style |
| Major | Pixel-ratio floor of 1 left a 1x display with one lever | Floor lowered to 0.5 |
| Minor | Null handle after a link failure under reduced motion; overclaiming governor comment; ANGLE-emulated vector indexing; about 27 KB of garbage per frame | Handle re-read; comment corrected; scalar selects; keyframe tables built once per label, uniforms walked by index, typed writes |

## Pass 2: owner review, frame by frame

The owner compared the live build with the reference and found four gaps:
- the opening lacked the two pills meeting;
- the ripple was not the trigger for the split;
- the splash was not smooth;
- the borders were grey.

Grids of reference and ours at matched times drove each fix:
- The opening: on every cycle, the first included, the previous label's pill and the new one glide in from either side. They touch at about 0.42 s and fuse; the old word fades and its body melts into the new one.
- The ripple is a leaning inward groove. It is born at the left cap at 1.45 s and reaches the right cap at 2.95 s. Its arrival starts the split: the right lobe swells and the waist pinches by 3.25 s, as in the reference.
- A press at rest now replays the whole wake from 1.25 s, which is a rest-identical instant (unit-tested).
- The body is nearly round in section (depth 0.95, label compensation 0.75), with a lilac-blue body tint. The studio is brightened (high key), so rims read clean rather than grey. The floor glows under the glass instead of greying.

Regressions accepted for now: the splash frame rose from 4.0 to 6.5 ms at 1080p (synced), and the cold shader-ready time rose from 1.7 to 2.2 s.

## Pass 3: owner review, outline and inner line

The owner found two more gaps against the reference: the pill's waist curved in too far, and a dark line ran along the inside of its bottom edge.

| Finding | Evidence | Fix, verified |
|---|---|---|
| Waist too deep | The top outline was traced per column at 1080p. The waist dipped 54 px (10.3% of the height) against the re-formed reference's 25 to 33 px (5 to 6.5%). Our outline dropped off each lobe into a flat neck; the reference sags in one curve from cap to cap | At rest the join's ends stand 1.06 times the lobe radius and the join eases down along a smoothstep to a 0.47 waist, with a tight 0.06 blend so the lobes inside it never swell the outline. Parameters fitted against the reference profile in a 2D model of the same distance field. The join morphs to the neck's power-1.5 profile as the waist thins, so the split is unchanged (frames at 3.25 to 7.4 s match the previous build). Measured: dip 31 px, sag at 25 to 50% of the length [0.19, 0.32, 0.54, 0.76, 0.92, 1] against the reference's [0.04, 0.24, 0.52, 0.76, 0.96, 1] |
| Dark line inside the bottom edge | Lighting terms switched off one at a time: the studio's thin horizon seam darkened the line by 0.08 in luminance (0.730 against 0.809 without it). Lower glass bends rays to exactly that direction. The reference shows no such line at rest or in the drops at 5.2 s; at 4.3 s its horizon is a faint mid-height line, not a dark band | Seam removed. The line now reads 0.807 to 0.809, level with the glass around it |

Checks after the pass: 19 unit tests, 7 pixel assertions, and the keyboard, phone, reduced-motion and no-WebGL checks pass. Synced frame times overlap the previous pass within run-to-run spread (1080p 2.89 to 3.52 ms, phone viewport 1.54 to 1.87 ms). Cold shader-ready measured 2.4 to 4.7 s with two dev servers running; too noisy to attribute without a quiet A/B.
