import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Set `base` so the build works when served from GitHub Pages at /<repo>/
// You can override by setting `VITE_BASE` env var in CI if needed.
export default defineConfig({
  base: process.env.VITE_BASE || '/tree/',
  plugins: [react()],
})
