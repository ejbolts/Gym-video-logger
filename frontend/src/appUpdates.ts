// Activate fresh assets in the background, but never reload an open workout or upload.
// The next navigation/reload uses the updated app shell.
export function registerAppUpdates() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        updateViaCache: 'none',
      });
      const checkForUpdate = () => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          void registration.update().catch(() => {
            // An offline or interrupted check leaves the installed app available.
          });
        }
      };
      document.addEventListener('visibilitychange', checkForUpdate);
      window.addEventListener('online', checkForUpdate);
      window.setInterval(checkForUpdate, 60 * 60 * 1000);
      checkForUpdate();
    } catch {
      // The app can still run online when service workers are unavailable.
    }
  };

  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}
