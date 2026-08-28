import { describe, expect, it } from 'vitest';
import { prepareExerciseInput, type ExerciseCreationDraft } from './exerciseCreation';

const draft: ExerciseCreationDraft = {
  name: '  Cable Lat Pullover  ',
  category: 'pull',
  kind: 'strength',
  muscle_group: ' Lats ',
  equipment: ' Cable ',
};

describe('new exercise validation', () => {
  it('normalizes the form into a typed creation payload', () => {
    expect(prepareExerciseInput(draft, [])).toEqual({
      name: 'Cable Lat Pullover',
      category: 'pull',
      kind: 'strength',
      muscle_group: 'Lats',
      equipment: 'Cable',
    });
  });

  it('accepts optional equipment and cardio exercises', () => {
    expect(
      prepareExerciseInput({ ...draft, category: 'cardio', kind: 'cardio', equipment: ' ' }, []),
    ).toMatchObject({ category: 'cardio', kind: 'cardio', equipment: null });
  });

  it.each([
    [{ name: ' ' }, 'Enter an exercise name.'],
    [{ category: '' }, 'Choose an exercise category.'],
    [{ muscle_group: ' ' }, 'Enter a muscle group.'],
    [{ name: 'a'.repeat(161) }, '160 characters'],
    [{ muscle_group: 'a'.repeat(101) }, '100 characters'],
    [{ equipment: 'a'.repeat(101) }, '100 characters'],
  ] as Array<[Partial<ExerciseCreationDraft>, string]>)(
    'rejects invalid fields: %o',
    (patch, error) => {
      expect(() => prepareExerciseInput({ ...draft, ...patch }, [])).toThrow(error);
    },
  );

  it('rejects an existing name regardless of whitespace or case', () => {
    expect(() => prepareExerciseInput(draft, [{ name: ' cable LAT pullover ' }])).toThrow(
      'already exists',
    );
  });
});
