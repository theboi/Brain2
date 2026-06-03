import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/global.css';
import App from './App';

// Apply stored theme/accent before first render to avoid FOUC
import { readStoredTheme, readStoredAccent, applyTheme } from '@/lib/tokens';
applyTheme(readStoredTheme(), readStoredAccent());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
