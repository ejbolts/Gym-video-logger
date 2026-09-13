import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardioEnergyCard } from './CardioEnergyCard';
import type { CardioEnergyPeriod } from './types';

const week: CardioEnergyPeriod = {
  period: 'week',
  start_date: '2026-08-31',
  end_date: '2026-09-06',
  calories_kcal: 1540,
  logged_sessions: 3,
  total_sessions: 4,
  previous_start_date: '2026-08-24',
  previous_end_date: '2026-08-30',
  previous_calories_kcal: 1200,
  average_heart_rate_bpm: 142,
  previous_average_heart_rate_bpm: 138,
  distance_km: 18.25,
  previous_distance_km: 16,
  average_speed_kph: 9.4,
  previous_average_speed_kph: 8.9,
  average_incline_percent: 7.5,
  previous_average_incline_percent: 6,
  heart_rate_sessions: 3,
  distance_sessions: 3,
  speed_sessions: 2,
  incline_sessions: 2,
};

describe('cardio energy card', () => {
  it('starts with the comparison details minimized', () => {
    const markup = renderToStaticMarkup(<CardioEnergyCard summaries={[week]} />);
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('Show details +');
    expect(markup).not.toContain('1,540 kcal');
    expect(markup).not.toContain('How comparisons work');
  });
  it('tolerates a cached dashboard from before calorie tracking', () => {
    expect(renderToStaticMarkup(<CardioEnergyCard summaries={undefined} />)).toBe('');
  });
});
