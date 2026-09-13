const updateSensitiveScreens = new Set(['#log', '#videos']);

function canReloadForUpdate(): boolean {
  return !updateSensitiveScreens.has(window.location.hash);
}

// Activate fresh assets in the background. Reload ordinary screens as soon as the
// new worker takes control, while leaving workout and upload screens uninterrupted.
export function registerAppUpdates() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  const register = async () => {
    try {
      let reloading = false;
      navigator.serviceWorker.addEventListener?.('controllerchange', () => {
        if (reloading || !canReloadForUpdate()) return;
        reloading = true;
        window.location.reload();
      });
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
