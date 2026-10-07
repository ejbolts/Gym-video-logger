import type { MainTab } from './appNavigation';
import { Icon, type IconName } from './Icon';
import { formatElapsed, useElapsedSeconds } from './elapsed';

const TABS: Array<{ tab: MainTab; label: string; icon: IconName }> = [
  { tab: 'dashboard', label: 'Today', icon: 'home' },
  { tab: 'history', label: 'History', icon: 'calendar' },
  { tab: 'progress', label: 'Progress', icon: 'trend' },
  { tab: 'body', label: 'Body', icon: 'body' },
];

export function AppTabBar({
  active,
  workoutStartedAt,
  onSelect,
  onStart,
}: {
  active: MainTab | null;
  workoutStartedAt: number | null;
  onSelect: (tab: MainTab) => void;
  onStart: () => void;
}) {
  const live = workoutStartedAt !== null;
  const renderTab = ({ tab, label, icon }: (typeof TABS)[number]) => (
    <button
      key={tab}
      type="button"
      className={`app-tab ${active === tab ? 'active' : ''}`}
      aria-current={active === tab ? 'page' : undefined}
      onClick={() => onSelect(tab)}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );

  return (
    <nav className="app-tab-bar" aria-label="Main navigation">
      {TABS.slice(0, 2).map(renderTab)}
      <button
        type="button"
        className={`app-tab app-tab-start ${live ? 'live' : ''}`}
        aria-label={live ? 'Resume active workout' : 'Start workout'}
        onClick={onStart}
      >
        <span className="app-tab-start-bubble">
          {live ? <i className="live-dot" aria-hidden="true" /> : <Icon name="plus" />}
        </span>
        <span>{live ? <LiveElapsed startedAt={workoutStartedAt} /> : 'Start'}</span>
      </button>
      {TABS.slice(2).map(renderTab)}
    </nav>
  );
}

function LiveElapsed({ startedAt }: { startedAt: number }) {
  const elapsed = useElapsedSeconds(startedAt);
  return <span className="num">{formatElapsed(elapsed)}</span>;
}
