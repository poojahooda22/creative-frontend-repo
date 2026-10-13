# Liquid Glass Button

- **Date:** 2026-10-12
- **Concept:** A glass pill button that comes alive: it ripples, pinches into two drops, splashes and pulls itself back together.
- **Reference:** [Labi, "Watch the Glass Button Come Alive."](https://x.com/HeyLabii/status/2099069035581407684), a 10 s 4K clip.
- **Principle:** a control earns attention by behaving like a material. Give the button one physical substance (water-clear glass) and let every state change be something that substance would really do: neck, break, splash, merge.
- **Technique:** one full-screen WebGL2 fragment shader. A sphere-traced SDF body (two lobes, an hourglass bridge, round-cone droplets, a crown) shaded as clear glass with refraction, Fresnel-weighted exits through total internal reflection, per-channel dispersion, Beer-Lambert absorption, a label inside the glass, an analytic glow integral for the inner light, and an analytic floor shadow and caustic. The ten-second choreography is a pure function of time. React for the shell, no three.js.
- **Skills used:** short-craft, design-taste-frontend, glsl-mastery, red-negation-loop, and the judgement loop.
- **Credits:** Labi for the reference. Inigo Quilez for the polynomial smooth minimum, the round-cone and capsule SDFs and the tetrahedral normal; on his normals page he credits Thomas Hooper for writing it as a loop and Clément Baticle (Klems) for the variant with a non-constant loop start, which this short's `ZERO` macro follows. Khronos for the PBR Neutral tone mapper. The mulberry32 generator, commonly attributed to Tommy Ettinger (authorship not verified). Type set in Geist (Vercel, SIL Open Font License).
- **Live:**

## Teardown of the reference

Frames were cut at 4 fps from the 1080p rendition of the post.

| Time | What happens |
|---|---|
| 0 to 0.75 s | The previous button ("Started") slides out left as "Explore" slides in; the two pills merge as they pass |
| 1.25 to 3.0 s | A white light wakes beside the divider and drifts past the arrow; a fold runs through the left lobe |
| 3.0 to 4.75 s | The waist necks into a dumbbell; the left lobe swells, the right shrinks; the camera drops toward the floor |
| 4.75 s | The thread breaks; a satellite drop clings to the big drop |
| 5.0 to 6.25 s | Two drops float apart with droplets around them; the backdrop warms to lilac |
| 6.5 to 7.25 s | The small drop swings back in front and crashes into the big one: a crown of tendrils and a spray |
| 7.5 to 8.5 s | The merged body stretches back into the pill and settles |

- **How it was made:** almost certainly a generative video model, not code. The tells are in the frames: the last "e" of "Explore" changes typeface at 2.0 s, the caption reads "CRE|EATIVE" at 1.0 s, "Started Explore" overlaps inside one blob at 0.5 s, the divider doubles at 8.4 s, and a four-point sparkle sits in the bottom right corner like a generator watermark (unverified).
- **Craft:** a near-white lavender cyclorama (measured at about #d6deed, warming to #d4ccde in the split), a flattened lozenge cross-section that keeps the label crisp, soft rectangular window highlights, a crisp inverted horizon inside each drop.
- **Weak spots:** it is a video, so it cannot be pressed; its text and divider glitch; nothing tells a viewer it is a button.

## What this piece advances

| Weak spot | Advance | Proof |
|---|---|---|
| A video, not a control | A real `<button>` with keyboard focus and Enter or Space; hover tilts the glass and the light follows the pointer; press dents and squashes it; release splits it | Keyboard and pointer runs in `CRITIC-LOG.md` |
| Glitching type | The label lives on a plane inside the glass and refracts physically; it stays crisp in the shallow pill and blurs as the drops round into ball lenses | Frame pairs against the reference |
| One fixed word | Any list of labels; each pill is sized to its word and each drop scales its word to fit | "Get started" frames |
| No fallback | Reduced motion shows still frames and a press swaps the label; without WebGL2 a CSS pill stands in | Reduced-motion and no-WebGL runs |

Performance numbers are lab numbers: headless Chromium on an RTX 3060 Ti through ANGLE D3D11, with the GPU synced after every frame. They have not been measured on a real phone.

See `CRITIC-LOG.md` for every scoring pass.

## Inspection

- `?t=5.2` holds the cycle at 5.2 s; `&label=1` picks the second label. Every frame in the critic log was rendered this way.
- `pnpm --filter ./shorts/2026-10-12-liquid-glass-button test` runs the choreography tests.
