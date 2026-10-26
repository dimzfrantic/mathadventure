import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resolveDevApiKey(): string | undefined {
  if (process.env.MATH_DRILL_API_KEY) {
    return process.env.MATH_DRILL_API_KEY
  }
  const configPath = path.resolve(__dirname, 'server/data/config.json')
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (typeof data.apiKey === 'string' && data.apiKey) {
        return data.apiKey
      }
    } catch {
      // ignore read/parse errors in development
    }
  }
  return undefined
}

const devApiKey = resolveDevApiKey()

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            if (devApiKey) {
              proxyReq.setHeader('X-API-Key', devApiKey)
            } else {
              console.warn('[vite-proxy] X-API-Key is not configured. Set MATH_DRILL_API_KEY or configure server/data/config.json.')
            }
          })
        },
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})

