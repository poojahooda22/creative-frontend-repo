# Creative frontend repo

One-concept daily shorts for the portfolio. Each short is a small, self-contained Vite app in `shorts/<YYYY-MM-DD>-<slug>/` that explores one visual idea.

Shorts are creative pieces, not product builds. Product-scale checklists (inventory, contested writes, search ranking, finance licensing) do not apply here. The scale questions that matter are frame time, GPU cost and how the piece holds up on a phone.

## Layout

| Path | What it holds |
|---|---|
| `shorts/` | One folder per short. Never import across shorts. |
| `templates/short-vite-three/` | The starting point `new-short` copies. Changing it affects future shorts only. |
| `scripts/new-short.mjs` | Creates a short from the template and adds its row to the log. |
| `context/shorts.md` | Log of every short: date, concept, technique, live link. |
| `.claude/skills/` | Skills specific to this repo, such as `/short-new`. |
| `.claude/settings.json` | Turns off global skills this repo never needs. |

## Daily routine

1. `/short-new <slug> "<one-line concept>"` (or `pnpm run new-short <slug> "<concept>"`).
2. Fill in `SHORT.md`: the reference being deconstructed, the principle taken from it, the technique.
3. `pnpm install` at the repo root, then `pnpm --filter ./shorts/<folder> dev`.
4. Build the concept in `src/scene.ts` (and new files beside it). `src/stage.ts` already handles the renderer, the frame loop, resizing and reduced motion.
5. `pnpm --filter ./shorts/<folder> build` must pass before the short counts as done.
6. Add the technique and live link to the short's row in `context/shorts.md`.

Capture (video export) and publishing are not set up yet.

## Stack

Vite 7, React 19, TypeScript 5.9, three 0.183, GSAP 3.14, `vite-plugin-glsl` for `.vert`/`.frag`/`.glsl` imports. pnpm workspaces: one install at the root serves every short.

Add React Three Fiber, Lenis or Tailwind inside a single short when that short needs them. Do not add them to the template.

## Rules for a short

- **Self-contained and frozen.** A finished short is never edited for another short's sake. Never upgrade dependencies in an older short. Copy code forward instead of sharing it.
- **Shaders:** GLSL ES 3.0 through `ShaderMaterial` with `glslVersion: THREE.GLSL3`. Declare `out vec4 fragColor;` in the fragment shader; with GLSL3, three 0.183 does not declare an output for you. Conventions: `~/.claude/rules-topical/glsl/shader-conventions.md`.
- **Quality bar:**
  - 60 fps on a mid-range phone, measured on a real device or with throttling. Say which.
  - Pixel ratio capped at 2 (the template does this).
  - A reduced-motion fallback: the template renders one still frame.
  - Correct on resize.
  - No console errors.
  - Every geometry, material, texture and render target disposed in the scene's `dispose()`.
- **Credits:** every technique learned from a tutorial or another piece is credited in `SHORT.md`.

## Skills

Invoke `/short-craft` before building, designing or animating a short; a session-start hook reminds you. It maps the short's technique to the two to four global skills to load, from the three.js pack (`threejs-*`), MengTo's 3D, UI and web-design skills, the taste skills (`design-taste-frontend` and others) and the earlier design and motion skills. Load more only when the work reaches them; every loaded skill costs context.

Some global skills and the topical rules under `~/.claude/rules-topical/craft/` and `rare/` were written for another person's projects (Rare.lab). Treat their project-specific paths and preferences as examples, not as rules for this repo.
