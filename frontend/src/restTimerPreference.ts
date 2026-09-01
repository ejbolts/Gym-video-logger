const REST_TIMER_PREFERENCE_KEY = 'gym-logger-rest-timer';

export function restTimerPreferenceEnabled(): boolean {
  try {
    return window.localStorage.getItem(REST_TIMER_PREFERENCE_KEY) !== 'disabled';
  } catch {
    return true;
  }
}

export function saveRestTimerPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(REST_TIMER_PREFERENCE_KEY, enabled ? 'enabled' : 'disabled');
  } catch {
    // Keep the in-memory setting usable if browser storage is unavailable.
  }
}
