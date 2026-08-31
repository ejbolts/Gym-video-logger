import { describe, expect, it } from 'vitest';
import { completesEdgeSwipe, EDGE_SWIPE_DISTANCE_PX } from './edgeSwipe';

describe('edge swipe back gesture', () => {
  it('accepts a decisive left-edge swipe to the right', () => {
    expect(completesEdgeSwipe(EDGE_SWIPE_DISTANCE_PX, 12)).toBe(true);
  });

  it('rejects short, leftward, and mostly vertical movement', () => {
    expect(completesEdgeSwipe(EDGE_SWIPE_DISTANCE_PX - 1, 0)).toBe(false);
    expect(completesEdgeSwipe(-100, 0)).toBe(false);
    expect(completesEdgeSwipe(90, 80)).toBe(false);
  });
});
