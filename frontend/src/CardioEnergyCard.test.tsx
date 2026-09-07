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
  it('compares all cardio performance metrics across the requested ranges', () => {
    const markup = renderToStaticMarkup(<CardioEnergyCard summaries={[week]} />);
    expect(markup).toContain('≈ 200 g');
    expect(markup).toContain('1,540 kcal');
    expect(markup).toContain('↑ 340 kcal vs prior');
    expect(markup).toContain('↑ 44 g vs prior');
    expect(markup).toContain('3 of 4 sessions logged');
    expect(markup).toContain('142 bpm');
    expect(markup).toContain('18.25 km');
    expect(markup).toContain('9.4 km/h');
    expect(markup).toContain('7.5%');
    expect(markup).toContain('Compared with');
    expect(markup).toContain('not measured fat burned or weight loss');
    for (const label of [
      'This week',
      'This month',
      '3 months',
      '6 months',
      'This year',
      'All time',
    ]) {
      expect(markup).toContain(label);
    }
  });
  it('keeps unknown calories distinct from zero', () => {
    const unknown = renderToStaticMarkup(
      <CardioEnergyCard summaries={[{ ...week, logged_sessions: 0, calories_kcal: 0 }]} />,
    );
    expect(unknown).toContain('No calories logged');
    expect(unknown).not.toContain('≈ 0 g');
    const zero = renderToStaticMarkup(
      <CardioEnergyCard summaries={[{ ...week, logged_sessions: 1, calories_kcal: 0 }]} />,
    );
    expect(zero).toContain('≈ 0 g');
    expect(zero).toContain('0 kcal');
  });
  it('tolerates a cached dashboard from before calorie tracking', () => {
    expect(renderToStaticMarkup(<CardioEnergyCard summaries={undefined} />)).toBe('');
  });
});
