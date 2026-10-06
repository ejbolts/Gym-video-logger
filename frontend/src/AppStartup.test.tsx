import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { AppTabBar } from './AppTabBar';
import { TodayScreen } from './TodayScreen';
import type { DashboardData, WorkoutTypeColors } from './types';

afterEach(() => {
  vi.unstubAllGlobals();
});

const colors: WorkoutTypeColors = {
  upper: '#8b5cf6',
  lower: '#f59e0b',
  push: '#ef476f',
  pull: '#3b82f6',
  full_body: '#14b8a6',
  cardio: '#22c55e',
  other: '#94a3b8',
};

function stubWindow(hash: string) {
  vi.stubGlobal('window', {
    history: { state: null },
    location: { hash },
    localStorage: { getItem: () => null },
  });
}

function renderToday(overrides: Partial<Parameters<typeof TodayScreen>[0]> = {}) {
  return renderToStaticMarkup(
    <TodayScreen
      data={
        {
          workouts_this_week: 4,
          sets_this_week: 25,
          volume_this_week_kg: 23057.5,
          current_streak: 4,
          cardio_minutes_this_week: 30,
          zone2: {
            week_start: '2026-10-05',
            week_end: '2026-10-11',
            goal_minutes: 150,
            completed_minutes: 30,
            remaining_minutes: 120,
            percentage: 20,
            complete: false,
          },
          weekly_sets: {
            week_start: '2026-10-05',
            week_end: '2026-10-11',
            raw_sets: 25,
            effective_sets: 25,
            unrated_sets: 0,
            low_rpe_sets: 0,
            rpe_logging_percent: 33.3,
            muscle_groups: [
              { muscle_group: 'Quadriceps', raw_sets: 10, effective_sets: 10, average_rpe: null },
              { muscle_group: 'Side delts', raw_sets: 0, effective_sets: 0, average_rpe: null },
            ],
          },
          recommendation: {
            category: 'pull',
            session_name: 'Pull workout',
            rotation_next: 'pull',
            reason: 'Next in your Push → Pull → Legs rotation.',
            muscle_frequency: [],
          },
        } as unknown as DashboardData
      }
      workouts={[]}
      measurements={[]}
      personalRecords={[]}
      categoryColors={colors}
      workoutStartedAt={null}
      todayBodyweight={null}
      onSaveBodyweight={vi.fn()}
      onStartTemplate={vi.fn()}
      onStartEmpty={vi.fn()}
      onResumeWorkout={vi.fn()}
      onOpenHistory={vi.fn()}
      onOpenProgress={vi.fn()}
      onOpenCardio={vi.fn()}
      onOpenBody={vi.fn()}
      onOpenSettings={vi.fn()}
      onOpenVideos={vi.fn()}
      today="2026-10-06"
      {...overrides}
    />,
  );
}

describe('App startup', () => {
  it('renders a Today-shaped skeleton before training data has loaded', () => {
    stubWindow('');

    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('today-loading-skeleton');
    expect(markup).toContain('Loading your training summary');
    expect(markup).toContain('aria-label="Main navigation"');
  });

  it('shows the recommendation, weekly totals, muscles, Zone 2 and quick check-in on Today', () => {
    const markup = renderToday();

    expect(markup).toContain('<h1>Today</h1>');
    expect(markup).toContain('Up next');
    expect(markup).toContain('Next in your Push → Pull → Legs rotation.');
    expect(markup).toContain('Pull day');
    expect(markup).toContain('Working sets</span><strong>25</strong>');
    expect(markup).toContain('Workouts</span><strong>4</strong>');
    expect(markup).toContain('23.1 t');
    expect(markup).toContain('Quadriceps');
    expect(markup).not.toContain('Side delts</span>');
    expect(markup).toContain('1 muscles not trained yet');
    expect(markup).toContain('120 min to go · 6 days left');
    expect(markup).toContain('4 days');
    expect(markup).toContain('Bodyweight in kilograms');
    expect(markup).toContain('aria-label="Video logger"');
    expect(markup).toContain('aria-label="Settings"');
    expect(markup).not.toContain('live-workout-card');
  });

  it('replaces the recommendation with a resumable live workout', () => {
    const markup = renderToday({ workoutStartedAt: Date.now() - 65_000, todayBodyweight: 84.1 });

    expect(markup).toContain('live-workout-card');
    expect(markup).toContain('Workout live');
    expect(markup).toContain('1:05');
    expect(markup).toContain('Today · 84.1 kg');
    expect(markup).not.toContain('next-session-title');
  });

  it('marks the active tab and shows live time on the Start button', () => {
    const idle = renderToStaticMarkup(
      <AppTabBar active="progress" workoutStartedAt={null} onSelect={vi.fn()} onStart={vi.fn()} />,
    );
    expect(idle.match(/class="app-tab /g)).toHaveLength(5);
    expect(idle).toContain('aria-label="Start workout"');
    expect(idle).toMatch(
      /class="app-tab active" aria-current="page"><svg[^>]*>.*?<\/svg><span>Progress<\/span>/,
    );

    const live = renderToStaticMarkup(
      <AppTabBar
        active={null}
        workoutStartedAt={Date.now() - 125_000}
        onSelect={vi.fn()}
        onStart={vi.fn()}
      />,
    );
    expect(live).toContain('aria-label="Resume active workout"');
    expect(live).toContain('2:05');
    expect(live).not.toContain('aria-current="page"');
  });

  it.each([
    ['settings', 'Settings', 'Timers • notifications • data'],
    ['videos', 'Videos', 'Workout clips • uploads'],
  ])('renders the overlay header on the %s screen', (tab, title, subtitle) => {
    stubWindow(`#${tab}`);

    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('class="overlay-screen-header"');
    expect(markup).toContain('with-overlay-header');
    expect(markup).toContain('aria-label="Go back"');
    expect(markup).toContain(`<strong>${title}</strong>`);
    expect(markup).toContain(`<span>${subtitle}</span>`);
  });

  it.each(['dashboard', 'history', 'progress', 'cardio', 'body'])(
    'uses the in-page title and tab bar instead of an overlay header on %s',
    (tab) => {
      stubWindow(`#${tab}`);

      const markup = renderToStaticMarkup(<App />);

      expect(markup).not.toContain('overlay-screen-header');
      expect(markup).not.toContain('with-overlay-header');
      expect(markup).toContain('class="tracker-app has-tab-bar"');
    },
  );

  it('hides the tab bar during a live workout', () => {
    stubWindow('#log');

    const markup = renderToStaticMarkup(<App />);

    expect(markup).not.toContain('aria-label="Main navigation"');
  });
});
