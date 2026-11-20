import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Recovery root missing')
createRoot(root).render(<App historyActivation={{ mode: 'live' }} />)
