---
name: short-craft
description: Pick the skills for a short in this repo before building, designing or animating it. Maps the short's technique (three.js scene, shader, scroll world, UI component, motion, particles, materials, review) to the two to four global skills to load first. Invoke at the start of every short and whenever the work moves to a new technique.
metadata:
  priority: 90
  promptSignals:
    minScore: 5
    phrases:
      - 'short'
      - 'three.js'
      - 'threejs'
      - 'webgl'
      - 'shader'
      - 'glsl'
      - 'immersive'
      - 'ui component'
      - 'scroll'
      - 'particles'
---

# Load the right skills for a short

Every global skill costs context once loaded, so load what the short's technique needs, not everything that might apply.

## Steps

1. **Name the technique** of the short in a few words, from `SHORT.md` or the user's brief.
2. **Always load `design-taste-frontend`.** It sets the art direction and blocks templated defaults.
3. **Load two or three skills from the matching rows below.** Prefer the first skill in a row; add the others only when the work reaches them.
4. **When the work moves to a new technique,** come back here and load that row.
5. **Before calling a short done,** load the Review row.

| Technique | Load |
|---|---|
| Three.js scene: lighting, materials, post, procedural forms | `threejs-skill-router` (it picks the `threejs-*` specialists), then `3d-wood-material`, `3d-metal-material`, `3d-cloth-material`, `3d-paper-material`, `3d-sky-background` or `3d-sky-rays` for the material or sky in question |
| Shader, GLSL, TSL or WebGPU | `glsl-mastery`, `tsl`, `webgpu-threejs-tsl`, `webgl-debugging-and-testing` |
| React Three Fiber | `r3f-fundamentals`, then `r3f-interaction`, `r3f-loaders`, `r3f-textures` or `r3f-physics` |
| Shaders on DOM elements | `dom-webgl-bridge`, `responsive-webgl-systems` |
| Scroll-driven world or story | `build-threejs-scroll-worlds`, `scroll-world-storytelling`, `scroll-scene-orchestration`, `cinematic-gsap-lenis-motion-system`, `horizontal-scroll-scenes` |
| UI component for a product | `emil-design-eng`, `animate`, `better-accessibility`, `micro-motion` |
| Motion and choreography | `animate`, `gsap-core`, `gsap-scrolltrigger`, `animation-systems` |
| Particles and cursor effects | `ambient-section-particles`, `build-interactive-particle-trail`, `pointer-trail-emitter`, `add-shader-cursor-trail`, `shaders-cursor-ripples`, `threejs-procedural-vfx` |
| Fluids and simulation | `fluid-simulation` |
| Atmospheric backgrounds | `atmosphere-background`, `background-grid-webgl`, `dither-background`, `webgl-laser` |
| Type reveals | `masked-reveal`, `staggered-word-reveal`, `scroll-scrubbed-word-reveal`, `better-typography` |
| Loaders and transitions | `fire-paper-loader`, `paper-cinder-transition` |
| A named visual direction | `high-end-visual-design`, `minimalist-ui`, `industrial-brutalist-ui`, `build-awwwards-quality-sites` |
| Performance and sharpness | `fixing-motion-performance`, `3d-retina-resolution`, `performance` |
| Review before done | `audit-ai-design-slop`, `threejs-visual-validation`, `review-animations`, `red-negation-loop`, and `playwright-cli` for screenshots |

## Failure modes

| Symptom | Cause | What to do |
|---|---|---|
| A skill named here will not load | It was removed or renamed globally | Run `/skills` to find its current name, then update this table |
| The work drifts generic | The taste skill was skipped | Load `design-taste-frontend` before writing more UI |
| Context fills before building starts | Too many skills loaded at once | Keep to the first skill of each row until the work needs more |
