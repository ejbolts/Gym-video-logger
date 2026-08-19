import { describe, expect, it } from 'vitest';
import {
  fuzzyHighlightIndices,
  fuzzyMatchIndices,
  fuzzyMatchesFields,
  fuzzyScoreFields,
} from './exerciseSearch';

describe('exercise fuzzy search', () => {
  it('prefers a contiguous match for highlighting', () => {
    expect(fuzzyMatchIndices('Single-Arm Lat Pulldown', 'lat')).toEqual([11, 12, 13]);
    expect(fuzzyMatchIndices('Plate Lat Pulldown', 'lat')).toEqual([6, 7, 8]);
  });

  it('matches non-adjacent letters in order', () => {
    const name = 'Single-Arm Lat Pulldown';
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
});
