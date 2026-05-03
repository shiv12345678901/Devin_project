import { execSync } from 'node:child_process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function detectBuildSha(): string {
  // Prefer an explicit env var (CI / Docker) so the value is reproducible.
  const envSha =
    process.env.VITE_BUILD_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.COMMIT_SHA
  if (envSha) return envSha.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:5000'
  const buildSha = detectBuildSha()
  const buildTime = new Date().toISOString()

  return {
    define: {
      __BUILD_SHA__: JSON.stringify(buildSha),
      __BUILD_TIME__: JSON.stringify(buildTime),
    },
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
        '^/(generate|generate-sse|generate-html|cancel|beautify|minify|extract-from-image|image-to-screenshots-sse|regenerate|screenshots|html|download|download-zip|list|delete|history|cache|metrics|preflight|upload-thumbnail|thumbnails|thumbnail-templates|youtube)(/.*)?$':
          {
            target: backendUrl,
            changeOrigin: true,
          },
      },
    },
  }
})
