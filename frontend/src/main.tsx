import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RunsProvider } from './store/RunsProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RunsProvider>
      <App />
    </RunsProvider>
  </StrictMode>,
)
