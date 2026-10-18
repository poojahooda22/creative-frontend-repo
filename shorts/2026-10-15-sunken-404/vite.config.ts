import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import glsl from 'vite-plugin-glsl'
import basicSsl from '@vitejs/plugin-basic-ssl'

/**
 * The page is a 404, so the build also ships it as `404.html`: a static host (Vercel among them)
 * serves that file, with a 404 status, for any path it has no file for. It may be served at any
 * depth (/docs/old-page), so its relative asset links are anchored to the site's root.
 */
function notFoundPage(): Plugin {
  return {
    name: 'sunken-404:not-found-page',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const index = bundle['index.html']
      if (!index || index.type !== 'asset') throw new Error('sunken-404: the build has no index.html to copy as 404.html')
      const html = typeof index.source === 'string' ? index.source : new TextDecoder().decode(index.source)
      if (!html.includes('<head>')) throw new Error('sunken-404: index.html has no <head> to anchor 404.html in')
      this.emitFile({ type: 'asset', fileName: '404.html', source: html.replace('<head>', '<head>\n    <base href="/" />') })
    },
  }
}

// Relative base so the built short works from any subpath of the portfolio. In `phone` mode the
// server speaks HTTPS with a throwaway certificate: phones report their tilt only to a secure page.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), glsl(), notFoundPage(), ...(mode === 'phone' ? [basicSsl()] : [])],
}))
