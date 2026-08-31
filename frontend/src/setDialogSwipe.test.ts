import { describe, expect, it } from 'vitest';
import { completesSetDialogDismissSwipe, SET_DIALOG_SWIPE_DISTANCE_PX } from './setDialogSwipe';

describe('set dialog swipe-to-dismiss gesture', () => {
  it('accepts a decisive downward swipe', () => {
    expect(completesSetDialogDismissSwipe(12, SET_DIALOG_SWIPE_DISTANCE_PX)).toBe(true);
  });

  it('rejects short, upward, and mostly horizontal movement', () => {
    expect(completesSetDialogDismissSwipe(0, SET_DIALOG_SWIPE_DISTANCE_PX - 1)).toBe(false);
    expect(completesSetDialogDismissSwipe(0, -100)).toBe(false);
    expect(completesSetDialogDismissSwipe(80, 90)).toBe(false);
  });
});
