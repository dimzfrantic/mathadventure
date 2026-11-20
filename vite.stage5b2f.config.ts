import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Explicit external build only. Default vite.config.ts and index.html stay unchanged.
export default defineConfig({ build: { rollupOptions: { input: { app: resolve(import.meta.dirname, 'index.html'), disposable: resolve(import.meta.dirname, 'stage5b2f-disposable.html') } } } })
