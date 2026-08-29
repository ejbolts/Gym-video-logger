import { describe, expect, it } from 'vitest';
import {
  fuzzyHighlightIndices,
  fuzzyMatchIndices,
  fuzzyMatchesFields,
  fuzzyScoreFields,
  progressExerciseMatches,
  rankExerciseSearchMatches,
} from './exerciseSearch';

describe('exercise fuzzy search', () => {
  it('prefers a contiguous match for highlighting', () => {
    expect(fuzzyMatchIndices('Single-Arm Lat Pulldown (Machine)', 'lat')).toEqual([11, 12, 13]);
    expect(fuzzyMatchIndices('Plate Lat Pulldown', 'lat')).toEqual([6, 7, 8]);
  });

  it('matches non-adjacent letters in order', () => {
    const name = 'Single-Arm Lat Pulldown (Machine)';
    const indices = fuzzyMatchIndices(name, 'slp');
    expect(indices?.map((index) => name[index].toLocaleLowerCase()).join('')).toBe('slp');
  });

  it('matches keywords across exercise metadata regardless of keyword order', () => {
    expect(fuzzyMatchesFields(['Leg Extension', 'Quads', 'Machine'], 'machine quad')).toBe(true);
    expect(fuzzyMatchesFields(['Leg Extension', 'Quads', 'Machine'], 'cable quad')).toBe(false);
  });

  it('ranks complete words and prefixes above scattered letters', () => {
    const directScore = fuzzyScoreFields(['Dumbbell Pullover', 'Lats', 'Dumbbell'], 'lat pu');
    const scatteredScore = fuzzyScoreFields(
      ['Bulgarian Split Squat', 'Quads', 'Dumbbell'],
      'lat pu',
    );

    expect(directScore).not.toBeNull();
    expect(scatteredScore).not.toBeNull();
    expect(directScore!).toBeLessThan(scatteredScore!);
  });

  it('does not match letters in the wrong order', () => {
    expect(fuzzyMatchIndices('Lat', 'tal')).toBeNull();
  });

  it('returns every matching character to render in bold', () => {
    expect(fuzzyHighlightIndices('Chest Supported Row', 'ch row')).toEqual([0, 1, 16, 17, 18]);
  });

  it('ranks a recently performed matching exercise above unused matches', () => {
    const exercises = [
      { id: 'floor', name: 'Crunch', muscle_group: 'Abs', equipment: null },
      { id: 'machine', name: 'Machine Ab Crunch', muscle_group: 'Abs', equipment: 'Machine' },
      { id: 'cable', name: 'Cable Crunch', muscle_group: 'Abs', equipment: 'Cable' },
    ];

    expect(rankExerciseSearchMatches(exercises, 'crunch', ['machine'])[0].id).toBe('machine');
  });

  it('orders performed search matches from most recently used to least recently used', () => {
    const exercises = [
      { id: 'older', name: 'Cable Crunch', muscle_group: 'Abs', equipment: 'Cable' },
      { id: 'latest', name: 'Machine Ab Crunch', muscle_group: 'Abs', equipment: 'Machine' },
    ];

    expect(rankExerciseSearchMatches(exercises, 'crunch', ['latest', 'older'])).toEqual([
      exercises[1],
      exercises[0],
    ]);
  });

  it('keeps fuzzy relevance ordering when neither exercise has been performed', () => {
    const exercises = [
      {
        id: 'scattered',
        name: 'Bulgarian Split Squat',
        muscle_group: 'Quads',
        equipment: 'Dumbbell',
      },
      { id: 'direct', name: 'Dumbbell Pullover', muscle_group: 'Lats', equipment: 'Dumbbell' },
    ];

    expect(rankExerciseSearchMatches(exercises, 'lat pu', [])[0].id).toBe('direct');
  });

  it('searches progress exercises by name, muscle group, and equipment', () => {
    const exercises = [
      { id: 'press', name: 'Chest Press', muscle_group: 'Chest', equipment: 'Machine' },
      { id: 'row', name: 'Seated Row', muscle_group: 'Back', equipment: 'Cable' },
      { id: 'curl', name: 'Preacher Curl', muscle_group: 'Biceps', equipment: 'Machine' },
    ];
    expect(progressExerciseMatches(exercises, 'row').map((item) => item.id)).toEqual(['row']);
    expect(progressExerciseMatches(exercises, 'back').map((item) => item.id)).toEqual(['row']);
    expect(progressExerciseMatches(exercises, 'cable').map((item) => item.id)).toEqual(['row']);
    expect(progressExerciseMatches(exercises, 'machine chest').map((item) => item.id)).toEqual([
      'press',
    ]);
  });

  it('shows the full progress exercise list alphabetically when browsing', () => {
    const exercises = [
      { id: 'z', name: 'Z Press', muscle_group: 'Shoulders', equipment: 'Barbell' },
      { id: 'a', name: 'Arnold Press', muscle_group: 'Shoulders', equipment: 'Dumbbell' },
    ];
    expect(progressExerciseMatches(exercises, '').map((item) => item.id)).toEqual(['a', 'z']);
    expect(progressExerciseMatches(exercises, 'no match')).toEqual([]);
  });
});
