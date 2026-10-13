# Critic log

Each pass follows build, render, judge, negate, re-judge. A dimension scores above 8 only when a screenshot or number from that pass proves it. Exit needs a weighted score above 9.0 with no dimension below 9.0.

Weights: concept 1.5, visual craft 1.5, rendering 1.5, motion 1.5, performance 1, responsiveness 1, robustness and access 1, code craft 1, polish 1.

## Pass 1: 8.29

| Dimension | Score | Evidence and gaps |
|---|---|---|
| Concept | 8.8 | The develop follows the bytes, and the errors are film failures. The prior-art search was thin. |
| Visual craft | 8.3 | The composition is clean, but the right column is sparse and the idle ghost reads as a skeleton |
| Rendering | 8.8 | The develop stages read as real integral film in crops |
| Motion | 7.0 | Not yet verified frame by frame |
| Performance | 8.5 | Lab only: p95 16.8 ms, 0 long tasks, 79 KB gzip |
| Responsiveness | 8.5 | Four sizes, no horizontal overflow |
| Robustness and access | 8.0 | Keyboard, chooser, drag states and paste verified. Reduced motion and fallback not yet verified. |
| Code craft | 8.5 | Typed state machine, no casts |
| Polish | 8.3 | Comma spacing from tabular figures, the print clipped by a stretched flex item, and a stretched status grid |

Fixed before pass 2: tabular figures on numbers only; the bay aligned to start; status rows aligned to start; the ready light moved beside the status; the size sample made a supported type; the demo network slowed so the develop follows the bytes.

## Negation round 1: proved junior, 4 major and 4 minor

| Severity | Finding | Evidence | Fix, verified |
|---|---|---|---|
| Major | Page-wide drops took files that other drop zones had claimed | react-dropzone@14.3.8 src/index.js about lines 465 to 487, 537, 596 to 612 and 745: document drops are only prevented, never accepted, and stopped propagation is respected | Camera-owned drops; `defaultPrevented` drops ignored; page drops opt-in; reset in the capture phase. A foreign zone's drop leaves the camera idle. |
| Major | A WebGL setup failure could crash the tree or block the camera | Our renderer threw from the effect | A 2D fallback on a fresh canvas. With WebGL2 forced off, the print still develops and files. |
| Major | `crypto.randomUUID` crashes outside secure contexts | MDN: secure contexts only | Counter ids. With `randomUUID` deleted, the page works. |
| Major | A full-resolution decode for a 640 px print, about 200 MB for 50 MP (8160 × 6120 × 4 B) | First principles | A bounded decode. A 400×200 image at `resizeWidth` 100 returns 100×50 in Chrome. |
| Minor | The waiting count sat inside the progressbar | WAI-ARIA 1.2: progressbar children are presentational | `aria-valuetext` "19% of 163 KB" |
| Minor | Focus was lost after Dismiss | Observed | Focus returns to Choose files |
| Minor | The blob was kept after success | Code read | Released on success |
| Minor | The gallery re-rendered on every progress tick | Code read | `memo` |

## Pass 2: 8.82

Concept 9.0, visual craft 8.5, rendering 9.0, motion 8.7, performance 8.8, responsiveness 9.0, robustness and access 9.0, code craft 8.8, polish 8.6.

- Motion verified by frame strips: the eject's leading edge emerges first and is out by about 440 ms; the gallery flight runs about 600 ms ease-in-out from the camera rectangle.
- Reduced motion verified with `document.getAnimations()`: the eject and the light's pulse are absent, and the gallery uses a fade.
- Gaps: the nested idle boxes and the flat slot; the flight had no landing; and a mobile-class performance run was still missing.

## Pass 3: in progress

Changes:
- Idle shows a single outline with loaded film under the slot, which feeds out on drag.
- The slot has depth and a lip; paragraphs use `text-wrap: pretty`.
- The flight lands past its angle and settles.
- A glint crosses the film after the eject.
- The develop loop moved into its own module.

Performance work, each step measured on headless Chrome with 4× CPU throttle at 390 × 844, DPR 3:

| Step | Long task at upload start |
|---|---|
| Baseline | 100 ms |
| Shader compile moved off the main thread with `KHR_parallel_shader_compile` | 67 to 100 ms |
| Texture uploaded from an `ImageBitmap` instead of a canvas (`texImage2D` 17.3 ms to 4.2 ms self time) | 67 to 81 ms |
| One warmed, reused surface (no `getContext` per upload) | 73 to 79 ms |
| Attribution: only the photo path showed it; the switch, the dud and the CSV did not | |
| `createImageBitmap` with `resizeQuality: 'high'` measured at 80 ms wall time with a 68 ms long task; `'medium'` 47 ms with none | |
| Bounded decode at `'medium'`, final crop at `'high'` | **0** in three runs, p95 frame 16.8 ms |

Regression on the pass 3 build: the drag states, drop, paste, reduced motion, foreign drop, WebGL-off fallback, http safety, focus restore and progressbar text all pass, with 0 console errors.
