import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './styles.css';

// Register after the first page load. A new version waits for the next launch instead of
// forcing a second reload while the current screen is already visible.
registerSW();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
