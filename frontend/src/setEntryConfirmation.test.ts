import { describe, expect, it } from 'vitest';
import { isUnusuallyHighWeight, unusualSetEntryWarning } from './setEntryConfirmation';

describe('set entry confirmation', () => {
  it('warns when a newly logged set is over 20 reps', () => {
    expect(unusualSetEntryWarning({ reps: 21, weightKg: 80, referenceWeightKg: 80 })?.title).toBe(
      'Add high rep set?',
    );
  });

  it('does not warn when editing another field on an existing high-rep set', () => {
    expect(
      unusualSetEntryWarning({
        reps: 25,
        originalReps: 25,
        weightKg: 80,
        referenceWeightKg: 80,
      }),
    ).toBeNull();
  });

  it('detects doubled loads, 100 kg jumps, and high values without a reference', () => {
    expect(isUnusuallyHighWeight(120, 60)).toBe(true);
    expect(isUnusuallyHighWeight(280, 180)).toBe(true);
    expect(isUnusuallyHighWeight(300, null)).toBe(true);
    expect(isUnusuallyHighWeight(180, 100)).toBe(false);
  });

  it('combines both warnings when reps and weight are unusually high', () => {
    expect(unusualSetEntryWarning({ reps: 30, weightKg: 300, referenceWeightKg: 100 })?.title).toBe(
      'Add high rep and weight set?',
    );
  });
});
