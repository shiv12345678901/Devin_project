import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { RunsProvider } from './store/RunsProvider'
import { SettingsProvider } from './store/SettingsProvider'
import { TrackedGenerationProvider } from './hooks/useTrackedGenerate'
import { ToastProvider } from './store/ToastProvider'
import { ConfirmProvider } from './components/ConfirmDialog'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <SettingsProvider>
        <ToastProvider>
          <ConfirmProvider>
            <RunsProvider>
              <TrackedGenerationProvider>
                <App />
              </TrackedGenerationProvider>
            </RunsProvider>
          </ConfirmProvider>
        </ToastProvider>
      </SettingsProvider>
    </ErrorBoundary>
  </StrictMode>,
)
