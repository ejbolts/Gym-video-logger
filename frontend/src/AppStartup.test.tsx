import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, DashboardScreen } from './App';
import type { DashboardData } from './types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App startup', () => {
  it('renders an animated menu-shaped skeleton before training data has loaded', () => {
    vi.stubGlobal('window', {
      history: { state: null },
      location: { hash: '' },
      localStorage: { getItem: () => null },
    });

    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('menu-loading-skeleton');
    expect(markup).toContain('menu-skeleton-shortcut');
    expect(markup).toContain('Loading training menu');
    expect(markup).not.toContain('Loading your training log');
  });

  it('keeps fresh dashboard data updates confined to the visible menu', () => {
    const markup = renderToStaticMarkup(
      <DashboardScreen
        data={
          {
            total_cardio_sessions: 14,
            cardio_minutes_this_week: 95,
            workouts_this_week: 4,
          } as DashboardData
        }
        totalWorkouts={120}
        bodyweight={82.6}
        bodyweightTrend={82.15}
        bodyweightTrendStatistic="average"
        workoutStartedAt={Date.now() - 65_000}
        onHistory={vi.fn()}
        onExercises={vi.fn()}
        onMeasurements={vi.fn()}
        onSettings={vi.fn()}
        onWorkoutLive={vi.fn()}
        todayBodyweight={null}
        onSaveBodyweight={vi.fn()}
      />,
    );

    expect(markup).toContain('Total workouts</span><strong>120</strong>');
    expect(markup).toContain('Bodyweight</span><strong>82.6 kg</strong>');
    expect(markup).toContain('Cardio sessions</span><strong>14</strong>');
    expect(markup).toContain('Weekly cardio</span><strong>95 min</strong>');
    expect(markup).toContain('BW average</span><strong>82.2 kg</strong>');
    expect(markup).toContain('Weeks workouts</span><strong>4</strong>');
    expect(markup).toContain('dashboard-shortcuts');
    expect(markup).toContain('dashboard-live-workout');
    expect(markup).toContain('Workout live');
    expect(markup).toContain('dashboard-live-duration');
    expect(markup).toContain('1:05');
    expect(markup).toContain('Measurements');
    expect(markup).toContain('DAILY CHECK-IN');
    expect(markup).toContain('Quick select bodyweight');
    expect(markup).not.toContain('Fat-energy equivalent');
    expect(markup).not.toContain('Powerlifting Level');
    expect(markup).not.toContain('heatmap-panel');
    expect(markup).not.toContain('recent-panel');
    expect(markup).not.toContain('muscle-volume-panel');
  });

  it('shows cached weekly cardio minutes while the dashboard API is being upgraded', () => {
    const markup = renderToStaticMarkup(
      <DashboardScreen
        data={{ zone2: { completed_minutes: 50 } } as DashboardData}
        totalWorkouts={1}
        bodyweight={84.2}
        bodyweightTrend={84.2}
        bodyweightTrendStatistic="median"
        workoutStartedAt={null}
        onHistory={vi.fn()}
        onExercises={vi.fn()}
        onMeasurements={vi.fn()}
        onSettings={vi.fn()}
        onWorkoutLive={vi.fn()}
        todayBodyweight={84.1}
        onSaveBodyweight={vi.fn()}
      />,
    );

    expect(markup).toContain('Weekly cardio</span><strong>50 min</strong>');
    expect(markup).toContain('Today · 84.1 kg');
    expect(markup).not.toContain('dashboard-live-workout');
  });

  it.each([
    ['body', 'Measurements', 'Bodyweight • goals • trends'],
    ['history', 'Workouts', 'History • exercise progress • cardio'],
    ['settings', 'Settings', 'Timers • notifications • data'],
    ['videos', 'Videos', 'Workout clips • uploads'],
  ])('renders the overlay header on the %s screen', (tab, title, subtitle) => {
    vi.stubGlobal('window', {
      history: { state: null },
      location: { hash: `#${tab}` },
      localStorage: { getItem: () => null },
    });

    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('class="overlay-screen-header"');
    expect(markup).toContain('with-overlay-header');
    expect(markup).toContain('aria-label="Go back"');
    expect(markup).toContain(`<strong>${title}</strong>`);
    expect(markup).toContain(`<span>${subtitle}</span>`);
    expect(markup).not.toContain('class="reference-app-header"');
  });

  it('keeps the overlay header off the main menu', () => {
    vi.stubGlobal('window', {
      history: { state: null },
      location: { hash: '#dashboard' },
      localStorage: { getItem: () => null },
    });

    const markup = renderToStaticMarkup(<App />);

    expect(markup).not.toContain('overlay-screen-header');
    expect(markup).not.toContain('with-overlay-header');
  });

  it('adds the bodyweight shortcut to the Measurements overlay header', () => {
    vi.stubGlobal('window', {
      history: { state: null },
      location: { hash: '#body' },
      localStorage: { getItem: () => null },
    });

    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('aria-label="Add bodyweight"');
    expect(markup).toContain('class="overlay-header-action add"');
  });
});
