import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthGate } from './AuthGate';
import { registerAppUpdates } from './appUpdates';
import { applyReduceMotion, reduceMotionPreference } from './motion';
import './styles.css';
import './pulse.css';
import './auth.css';
import './releaseAnnouncement.css';
import './homeScreenGuide.css';

registerAppUpdates();
// Apply before the first paint so the opening screen respects the setting.
applyReduceMotion(reduceMotionPreference());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
);
