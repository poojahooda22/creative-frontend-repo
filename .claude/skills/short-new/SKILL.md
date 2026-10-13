---
name: short-new
description: Start a new daily short in this repo. Copies the Vite + React + three.js template into shorts/<date>-<slug>/, fills its SHORT.md brief and adds a row to context/shorts.md. Use when the user says new short, start a short, today's short, or names a concept to build as a short.
argument-hint: <slug> ["one-line concept"]
allowed-tools: Bash(pnpm run new-short *)
metadata:
  priority: 70
  promptSignals:
    minScore: 6
    phrases:
      - 'new short'
      - 'start a short'
      - "today's short"
      - 'daily short'
      - 'short-new'
---

# Start a new short

## Steps

1. **Pick the slug.** Use the argument if given. Otherwise derive 2 to 4 kebab-case words from the concept (`letters on a torus` becomes `torus-letters`). Lowercase letters, digits and single hyphens only.
2. **Create it** from the repo root:
   ```bash
   pnpm run new-short <slug> "<one-line concept>"
   ```
   Pass `--date YYYY-MM-DD` only when the user asks for a date other than today.
3. **Fill in `shorts/<date>-<slug>/SHORT.md`** with what the user said: the reference being deconstructed, the principle taken from it, the technique. Leave a field as written when it is unknown; do not invent a reference or a credit.
4. **Pick the skills** for the technique from the "Global skills to reach for" table in the root `CLAUDE.md`, and list them under "Skills used".
5. **Tell the user** the folder name and the next commands: `pnpm install`, then `pnpm --filter ./shorts/<date>-<slug> dev`.

## Failure modes

| Script output | Cause | What to do |
|---|---|---|
| `slug must be kebab-case` | Spaces, capitals or symbols in the slug | Fix the slug and run again |
| `shorts/<name> already exists` | A short with this slug exists for that date | Ask whether to continue that short or choose a new slug. Never delete the existing folder |
| `template not found` / `log not found` | The repo layout changed | Stop and report; do not recreate the template by hand |
