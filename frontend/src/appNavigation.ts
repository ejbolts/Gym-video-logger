export const APP_TABS = ['dashboard', 'log', 'body', 'history', 'videos', 'settings'] as const;

export type AppTab = (typeof APP_TABS)[number];

export interface AppHistoryState {
  gymLogger: true;
  index: number;
  tab: AppTab;
}

export function isAppTab(value: unknown): value is AppTab {
  return typeof value === 'string' && APP_TABS.includes(value as AppTab);
}

export function isAppHistoryState(value: unknown): value is AppHistoryState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AppHistoryState>;
  return (
    candidate.gymLogger === true &&
    Number.isInteger(candidate.index) &&
    (candidate.index ?? -1) >= 0 &&
    isAppTab(candidate.tab)
  );
}

export function appTabFromHash(hash: string): AppTab {
  const requested = hash.replace(/^#/, '');
  return isAppTab(requested) ? requested : 'dashboard';
}

export function createAppHistoryState(tab: AppTab, index: number): AppHistoryState {
  return { gymLogger: true, index, tab };
}
