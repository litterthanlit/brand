import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { loadArtworkFonts } from './lib/fonts'

// Artwork text is measured on the canvas, so fonts must be ready before the first render.
loadArtworkFonts().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
