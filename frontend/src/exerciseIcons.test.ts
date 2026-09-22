import { describe, expect, it } from 'vitest';
import { exerciseIconKey } from './exerciseIcons';
import type { Exercise } from './types';

function exercise(
  name: string,
  overrides: Partial<Pick<Exercise, 'kind' | 'category' | 'muscle_group' | 'equipment'>> = {},
) {
  return {
    name,
    kind: 'strength' as const,
    category: 'other' as const,
    muscle_group: '',
    equipment: null,
    ...overrides,
  };
}

describe('exerciseIconKey', () => {
  it('maps the new machine and lower-body illustrations', () => {
    expect(exerciseIconKey(exercise('Pec Deck'))).toBe('pec-deck');
    expect(exerciseIconKey(exercise('Hack Squat'))).toBe('hack-squat');
    expect(exerciseIconKey(exercise('Romanian Deadlift'))).toBe('romanian-deadlift');
    expect(exerciseIconKey(exercise('Seated Ab Crunch Machine'))).toBe('ab-crunch-machine');
  });

  it('uses the dedicated quad-and-calf incline walking image', () => {
    expect(
      exerciseIconKey(
        exercise('Incline Treadmill Walking', {
          kind: 'cardio',
          category: 'cardio',
          equipment: 'Treadmill',
        }),
      ),
    ).toBe('incline-walk');
  });

  it('maps cardio activities and custom exercise names to a useful fallback', () => {
    expect(exerciseIconKey(exercise('Cycling (Indoor)', { kind: 'cardio' }))).toBe('cycling');
    expect(exerciseIconKey(exercise('Outdoor rowing', { kind: 'cardio' }))).toBe('rowing');
    expect(
      exerciseIconKey(
        exercise('My custom quad movement', { category: 'lower', muscle_group: 'Quadriceps' }),
      ),
    ).toBe('back-squat');
    expect(exerciseIconKey(exercise('Custom cable extension', { muscle_group: 'Triceps' }))).toBe(
      'triceps-pushdown',
    );
  });
});
