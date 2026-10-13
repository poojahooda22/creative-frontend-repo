// SessionStart: plain stdout is added to Claude's context at the start of the session.
process.stdout.write(
  'This repo builds immersive frontend shorts (three.js, WebGL, shaders, motion, UI components). ' +
    'Before building, designing or animating any short, invoke the /short-craft skill: it names the ' +
    'global skills to load for the short\'s technique, and design-taste-frontend is always one of them.\n',
)
