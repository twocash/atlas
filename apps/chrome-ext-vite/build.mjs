/**
 * Atlas Chrome Extension — Build Script
 *
 * Three independent builds with zero framework magic:
 * 1. Vite builds the sidepanel (React + Tailwind)
 * 2. esbuild bundles each content script
 * 3. esbuild bundles the background service worker
 * 4. manifest.json + icons are copied to dist/
 */

import { build as viteBuild } from 'vite'
import * as esbuild from 'esbuild'
import { cpSync, rmSync, mkdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dist = resolve(__dirname, 'dist')

// Clean dist
if (existsSync(dist)) rmSync(dist, { recursive: true })
mkdirSync(dist, { recursive: true })

console.log('=== Atlas Extension Build ===\n')

// 1. Vite: Sidepanel (React + Tailwind)
console.log('[1/4] Building sidepanel with Vite...')
await viteBuild({
  configFile: resolve(__dirname, 'vite.config.ts'),
  logLevel: 'warn',
})
console.log('  ✓ Sidepanel built\n')

// 2. esbuild: Content Scripts
console.log('[2/4] Building content scripts with esbuild...')
const contentScripts = [
  { entry: 'src/contents/linkedin-feed.ts', out: 'content-scripts/linkedin-feed.js' },
  { entry: 'src/contents/linkedin.ts', out: 'content-scripts/linkedin.js' },
]

for (const { entry, out } of contentScripts) {
  await esbuild.build({
    entryPoints: [resolve(__dirname, entry)],
    outfile: resolve(dist, out),
    bundle: true,
    minify: true,
    format: 'iife', // Content scripts must be IIFE (no ES modules)
    target: 'chrome120',
    // Alias resolution for ~src/ paths
    alias: {
      '~src': resolve(__dirname, 'src'),
    },
  })
  console.log(`  ✓ ${entry} → dist/${out}`)
}
console.log()

// 3. esbuild: Background Service Worker
console.log('[3/4] Building background worker with esbuild...')
await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/background/index.ts')],
  outfile: resolve(dist, 'background.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'chrome120',
  alias: {
    '~src': resolve(__dirname, 'src'),
  },
})
console.log('  ✓ background.js built\n')

// 4. Copy static assets
console.log('[4/4] Copying manifest + icons...')
cpSync(resolve(__dirname, 'manifest.json'), resolve(dist, 'manifest.json'))

// Copy icon (source icon used at all sizes — Chrome will scale)
const iconSrc = resolve(__dirname, 'assets/icon.png')
const iconsOut = resolve(dist, 'icons')
mkdirSync(iconsOut, { recursive: true })
if (existsSync(iconSrc)) {
  for (const size of [16, 32, 48, 64, 128]) {
    cpSync(iconSrc, resolve(iconsOut, `icon${size}.png`))
  }
  console.log('  ✓ Icons copied (5 sizes)')
} else {
  console.log('  ⚠ No icon.png found in assets/')
}

console.log('  ✓ manifest.json copied')
console.log('\n=== Build complete! Load dist/ as unpacked extension ===')
