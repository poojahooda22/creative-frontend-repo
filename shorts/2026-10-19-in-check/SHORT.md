# In Check

- **Date:** 2026-10-19
- **Concept:** A personal daily tracker: two goals, a 22-hour bar with DSA inside it, a note each day the next day answers to, and a streak, in one hue
- **Reference:** the devices the live trackers share, each read from its own site on 2026-10-19. [Everyday](https://everyday.app) and [GitHub's contribution graph](https://github.com/torvalds) draw the year as a grid of shaded cells. [Streaks](https://streaksapp.com) keeps one number per habit, with a visible reset. [Habitify](https://www.habitify.me) and [Daylio](https://daylio.net) give each day a note and a calendar. All of them put today first.
- **Principle:** a tracker works when tomorrow has to look at today. The record is written to be read the next morning, so each day's numbers and note sit next to a plain verdict ("Behind.") rather than a reward, and the only way to improve the verdict is to do more.
- **Technique:**
  - **One hue, and green for done.** Ink, about 228°, in eleven steps from the page to the brightest tint: every surface, line, letter and chart column is one of the steps, and the light theme is the same scale the other way up. The one meaning colour is green, for done: a switch turned on, a day that counted, a shipped system, the verdict when the day is on the bar, the streak's flame while it is alive. The greens are GitHub's (Primer), read off github.com on 2026-10-19: the contribution graph's four levels (dark #033a16, #196c2e, #2ea043, #56d364; light #aceebb, #4ac26b, #2da44e, #116329) for the year grid and the columns, and its success tokens (`fgColor-success` #3fb950 / #1a7f37, `bgColor-success-emphasis` #238636 / #1f883d) for the rest.
  - **The day.** A day starts at 04:00, so work past midnight stays with the day it belongs to. A day counts when the gym is done and the hours reach the bar (22 by default; a setting). The streak counts back from today, or from yesterday while today is still open.
  - **The verdict.** Yesterday's numbers and note beside today's, with the gap in hours and problems spelled out. Written as plain sentences by one pure function, with tests.
  - **The pictures.** Fourteen days as HTML columns against a dashed bar, DSA hours inside each; the year as an SVG grid of 53 weeks shaded by how full each day was, opened scrolled to today on a phone.
  - **The record.** `localStorage`, a versioned schema, every import validated and clamped (a bad file is refused with the reason), JSON export and import for backup. No account and no server: the data lives in the browser it was typed into.
  - React 19 and TypeScript, no other libraries; 15 unit tests on the day, streak, summary, verdict, year grid and storage code.
- **Skills used:** design-taste-frontend, better-ui, better-accessibility (44 px targets on touch, switches with real roles, focus rings, reduced motion).
- **Credits:**
  - Everyday and GitHub for the year as a grid of cells; Streaks for the one number with a visible reset; Habitify and Daylio for the note on each day.
  - Type set in Geist and Geist Mono (Vercel, SIL Open Font License).
- **Live:** [in-check-ten.vercel.app](https://in-check-ten.vercel.app)

## What this piece adds

| Gap in the trackers studied | Addition |
|---|---|
| A streak is the only feedback, and it only ever flatters or resets | A verdict in words: yesterday beside today, the shortfall in hours and problems named, and the note from yesterday in full |
| Hours are a single number | The bar, and DSA inside it, drawn in the same column, so the share is visible at a glance |
| The day ends at midnight | A day that starts at 04:00 |
| An account, a sync, a subscription | A file: export it, import it, own it |

## Inspection

- `pnpm --filter ./shorts/2026-10-19-in-check test` runs the model's tests.
- Export JSON gives the whole record as one readable file; Import JSON takes it back, and refuses anything that is not one, with the reason.
