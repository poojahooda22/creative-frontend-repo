# Instant Film Upload

- **Date:** 2026-10-12
- **Concept:** A file upload where each file prints as instant film and develops as its bytes arrive.
- **Reference:** [Ramin Nasibov, "File upload, basketball style"](https://x.com/RaminNasibov/status/2109179709703504284), via [abduzeedo's quote asking for error states](https://x.com/abduzeedo/status/2109309428948468193).
- **Principle:** give an invisible system process a physical ritual whose success and failure everyone already recognises, so progress and errors read at a glance without words.
- **Technique:** React 19, raw WebGL2 develop shader (no three.js), WAAPI motion, a typed upload queue with a pluggable transport.
- **Skills used:** product-strategist, frontend-design, animate, red-negation-loop, and the judgement loop.
- **Credits:** Ramin Nasibov for the shot and abduzeedo for the error-state challenge. Poladroid (2008) and Aidan Looker's Framer component "Polaroid on Scroll" for earlier eject-and-develop effects. Sample photos from Lorem Picsum (Unsplash licence): ids 1060, 766 and 431. Type set in Schibsted Grotesk and Nanum Pen Script.
- **Live:**

## Teardown of the shot

Frames were cut at 4 fps from the 7.5 s post.

| Time | What happens |
|---|---|
| 0 to 0.75 s | The cursor grabs `moodboard.png` from the bottom left |
| 1.0 s | A flick throw, with a dotted trail |
| 1.75 to 2.0 s | It hits the backboard. The card turns red: "Missed! Try again" |
| 2.25 to 3.25 s | The file bounces to the bottom right and is picked up again |
| 3.75 to 4.25 s | A second throw goes in. The card highlights blue on approach |
| 4.5 to 6.0 s | "Uploading 0% to 100%": the net fills blue from the bottom |
| 6.25 s | "Uploaded, 2.4 MB": the net and card turn green, then reset |

- **Hook:** the miss. Failure is played for a laugh in the first two seconds.
- **Craft:** flat line art, soft shadows, a three-colour state system (blue, red, green), and the net doubling as the progress bar.
- **Weak spots:** the miss is a skill failure, not a system error. The throw only works on an in-canvas icon, not a real file. There is no keyboard or screen reader path. Retrying a throw is friction in a work tool.

## What this piece advances

| Weak spot | Advance | Proof |
|---|---|---|
| No real error states | Dud print, overexposed print, fogged print with Retry, each with plain copy | Screenshots of each state in `media/progress-board.png` |
| Fake in-canvas drag | Real OS drag and drop, type checked while dragging, plus Choose files and paste | Drag-over and invalid-type captures; a real file uploaded through the system file chooser |
| Pointer-only | Keyboard path, focus management, live announcements, reduced motion | Tab reaches Choose files first, Enter opens the chooser, focus returns after Dismiss |
| Progress beside the content | The upload's own image develops as the bytes arrive (on fast links, a two-second reveal) | Frame strips of the develop |
| One file at a time | Three uploads in flight; files that finish while the camera is busy go straight to the gallery | Ten files filed in 0.37 s on a simulated 50 Mbit/s link |

Performance numbers are lab numbers: headless Chrome on a desktop GPU, with the CPU throttled four times and a 390 by 844 viewport at DPR 3. They have not been measured on a real phone.

See `IDEAS.md` for the six concepts considered and `CRITIC-LOG.md` for every scoring pass.
