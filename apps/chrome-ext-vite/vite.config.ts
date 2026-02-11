import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  base: './', // Relative paths — required for Chrome extensions
  plugins: [react()],
  resolve: {
    alias: {
      '~src': resolve(__dirname, 'src'),
      '~sidepanel': resolve(__dirname, 'sidepanel'),
      '~lib': resolve(__dirname, 'src/lib'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false, // build.mjs handles cleaning
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
      },
      output: {
        // Predictable filenames (no hashes) for manifest references
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
    // No code splitting — single bundle for sidepanel
    cssCodeSplit: false,
  },
})
