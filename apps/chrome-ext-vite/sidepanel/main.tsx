import React from 'react'
import { createRoot } from 'react-dom/client'
import SidePanel from './SidePanel'
import './style.css'

const root = document.getElementById('root')!
createRoot(root).render(
  <React.StrictMode>
    <SidePanel />
  </React.StrictMode>
)
