import { describe, expect, it } from 'vitest';
import { evenlySpacedChartIndexes, paddedChartRange, responsiveChartWidth } from './chartLayout';

describe('responsive chart layout', () => {
  it('keeps the compact chart geometry in a normal card', () => {
    expect(responsiveChartWidth(340, 190)).toBe(340);
    expect(responsiveChartWidth(300, 300)).toBe(340);
  });

  it('widens the chart view box to match a landscape canvas', () => {
    expect(responsiveChartWidth(1200, 400)).toBe(570);
  });

  it('adds evenly spaced labels when there is room', () => {
    expect(evenlySpacedChartIndexes(12, 5)).toEqual([0, 3, 6, 8, 11]);
    expect(evenlySpacedChartIndexes(3, 5)).toEqual([0, 1, 2]);
  });

  it('pads chart values without forcing the scale down to zero', () => {
    expect(paddedChartRange([80, 90])).toEqual({ min: 78.5, max: 91.5 });
    expect(paddedChartRange([100, 100])).toEqual({ min: 99.7, max: 100.3 });
    expect(paddedChartRange([null, Number.NaN])).toBeNull();
  });
});
