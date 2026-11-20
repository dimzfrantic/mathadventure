import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Explicit recovery-only entry: never used by the normal application build.
export default defineConfig({ build: { rollupOptions: { input: resolve(import.meta.dirname, 'stage5b2f-recovery.html') } } })
