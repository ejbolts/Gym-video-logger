export const EDGE_SWIPE_START_PX = 32;
export const EDGE_SWIPE_DISTANCE_PX = 76;

export function completesEdgeSwipe(deltaX: number, deltaY: number): boolean {
  return deltaX >= EDGE_SWIPE_DISTANCE_PX && deltaX > Math.abs(deltaY) * 1.35;
}
