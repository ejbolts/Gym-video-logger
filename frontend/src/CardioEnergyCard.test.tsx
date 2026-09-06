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
};

describe('cardio energy card', () => {
  it('shows calories, a labelled equivalent, coverage and all requested ranges', () => {
    const markup = renderToStaticMarkup(<CardioEnergyCard summaries={[week]} />);
    expect(markup).toContain('≈ 200 g');
    expect(markup).toContain('1,540 kcal logged');
    expect(markup).toContain('3 of 4 sessions with calories');
    expect(markup).toContain('1 not logged');
    expect(markup).toContain('Energy comparison, not measured fat loss.');
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
    expect(unknown).toContain('No calories logged yet');
    expect(unknown).not.toContain('≈ 0 g');
    const zero = renderToStaticMarkup(
      <CardioEnergyCard summaries={[{ ...week, logged_sessions: 1, calories_kcal: 0 }]} />,
    );
    expect(zero).toContain('≈ 0 g');
    expect(zero).toContain('0 kcal logged');
  });
  it('tolerates a cached dashboard from before calorie tracking', () => {
    expect(renderToStaticMarkup(<CardioEnergyCard summaries={undefined} />)).toBe('');
  });
});
