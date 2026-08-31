export const SET_DIALOG_SWIPE_DISTANCE_PX = 72;

export function completesSetDialogDismissSwipe(deltaX: number, deltaY: number): boolean {
  return deltaY >= SET_DIALOG_SWIPE_DISTANCE_PX && deltaY > Math.abs(deltaX) * 1.25;
}
