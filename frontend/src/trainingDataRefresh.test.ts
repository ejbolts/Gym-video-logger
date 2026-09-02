import { describe, expect, it } from 'vitest';
import { trainingDataActivityLabel } from './trainingDataRefresh';

describe('training data refresh feedback', () => {
  it('keeps startup and navigation restoration silent', () => {
    expect(trainingDataActivityLabel('startup')).toBeNull();
    expect(trainingDataActivityLabel('navigation')).toBeNull();
  });

  it('shows the background pill after a data mutation', () => {
    expect(trainingDataActivityLabel('mutation')).toBe('Updating training data…');
  });
});
