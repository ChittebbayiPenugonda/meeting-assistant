import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'highlight.js/styles/github-dark.css'
import './practice.css'
import Practice from './Practice'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Practice />
  </StrictMode>,
)
