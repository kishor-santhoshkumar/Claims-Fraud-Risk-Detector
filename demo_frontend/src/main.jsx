import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './AuthContext.jsx'
import { SimulationProvider } from './SimulationContext.jsx'
import { DecisionsProvider } from './DecisionsContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SimulationProvider>
          <DecisionsProvider>
            <App />
          </DecisionsProvider>
        </SimulationProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
