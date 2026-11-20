import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startStartupSessionUploadRetry } from './features/math-drill/persistence/sessionUploadRetry.ts'

// Stage 7B-A2 limited remediation (finding B): deliver a session upload backlog
// left by an earlier page load as soon as the app is ready, instead of waiting
// for the child to open Math Drill or finish another session. Safe no-op when
// nothing is pending; single-flight with every other flush trigger.
startStartupSessionUploadRetry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App historyActivation={{ mode: 'live' }} />
  </StrictMode>,
)
