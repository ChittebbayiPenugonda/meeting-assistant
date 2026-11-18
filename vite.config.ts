import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// base './' so the build works from any GitHub Pages sub-path (/<repo>/).
// Two pages: the phone Meeting Copilot (/) and the Practice Pad (/practice/).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        practice: resolve(import.meta.dirname, 'practice/index.html'),
      },
    },
  },
})
