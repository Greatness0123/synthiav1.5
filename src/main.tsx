/**
 * React DOM initialization and application mounting.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './App.tsx'
import { CoordinatorProvider } from './world/contexts/CoordinatorContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CoordinatorProvider>
      <App />
    </CoordinatorProvider>
  </StrictMode>,
)
