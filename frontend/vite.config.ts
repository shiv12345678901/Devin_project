import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:5000'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // Proxy all Flask API routes to the local backend during development.
        // Any path not matched below is served by Vite (the React app).
        '/runs': {
          target: backendUrl,
          changeOrigin: true,
        },
        '^/(generate|generate-sse|generate-html|cancel|beautify|minify|extract-from-image|image-to-screenshots-sse|regenerate|screenshots|html|download|download-zip|list|delete|history|cache|metrics|preflight|upload-thumbnail|thumbnails)(/.*)?$':
          {
            target: backendUrl,
            changeOrigin: true,
          },
      },
    },
  }
})
