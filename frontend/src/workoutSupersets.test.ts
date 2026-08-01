import { describe, expect, it } from 'vitest';
import { applySupersetSelection, clearSuperset } from './workoutSupersets';

type Movement = {
  key: string;
  name: string;
  supersetKey: string | null;
};

const movements: Movement[] = [
  { key: 'bench', name: 'Bench press', supersetKey: null },
  { key: 'row', name: 'Cable row', supersetKey: null },
  { key: 'curl', name: 'Biceps curl', supersetKey: null },
  { key: 'squat', name: 'Squat', supersetKey: 'other-group' },
];

describe('superset selection', () => {
  it('groups the anchor with every selected exercise', () => {
    const grouped = applySupersetSelection(movements, 'bench', ['row', 'curl'], 'new-group');

    expect(grouped.map((movement) => movement.supersetKey)).toEqual([
      'new-group',
      'new-group',
      'new-group',
      'other-group',
    ]);
  });

  it('updates an existing group and unlinks deselected members', () => {
    const grouped = applySupersetSelection(movements, 'bench', ['row'], 'group');
    const updated = applySupersetSelection(grouped, 'bench', ['curl'], 'unused-group');

    expect(updated.find((movement) => movement.key === 'bench')?.supersetKey).toBe('group');
    expect(updated.find((movement) => movement.key === 'row')?.supersetKey).toBeNull();
    expect(updated.find((movement) => movement.key === 'curl')?.supersetKey).toBe('group');
  });

  it('removes the whole group from any member', () => {
    const grouped = applySupersetSelection(movements, 'bench', ['row'], 'group');
    const cleared = clearSuperset(grouped, 'row');

    expect(cleared.find((movement) => movement.key === 'bench')?.supersetKey).toBeNull();
    expect(cleared.find((movement) => movement.key === 'row')?.supersetKey).toBeNull();
  });
});
