import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RunsProvider } from './store/RunsProvider'
import { SettingsProvider } from './store/SettingsProvider'
import { TrackedGenerationProvider } from './hooks/useTrackedGenerate'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <RunsProvider>
        <TrackedGenerationProvider>
          <App />
        </TrackedGenerationProvider>
      </RunsProvider>
    </SettingsProvider>
  </StrictMode>,
)
