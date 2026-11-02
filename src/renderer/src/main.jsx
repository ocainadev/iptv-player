import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initBackButton } from './lib/native'
import { initTvMode } from './lib/tv'
import './styles.css'

initBackButton()

// Render after the TV check so the first paint is already in the right mode.
initTvMode().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
