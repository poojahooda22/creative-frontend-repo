import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import glsl from 'vite-plugin-glsl'

// Relative base so the built short works from any subpath of the portfolio.
export default defineConfig({
  base: './',
  plugins: [react(), glsl()],
})
