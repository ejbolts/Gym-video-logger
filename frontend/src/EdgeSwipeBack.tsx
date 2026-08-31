import { useEffect, useRef } from 'react';
import { completesEdgeSwipe, EDGE_SWIPE_DISTANCE_PX, EDGE_SWIPE_START_PX } from './edgeSwipe';

function isStandalonePwa(): boolean {
  const iosNavigator = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches || iosNavigator.standalone === true
  );
}

export function EdgeSwipeBack({ onBack, enabled }: { onBack: () => void; enabled: boolean }) {
  const onBackRef = useRef(onBack);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!enabled || !isStandalonePwa()) return;

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let horizontal = false;

    const reset = () => {
      pointerId = null;
      horizontal = false;
      document.documentElement.classList.remove('edge-swipe-active');
      document.documentElement.style.removeProperty('--edge-swipe-progress');
    };

    const onPointerDown = (event: PointerEvent) => {
      if (
        !event.isPrimary ||
        (event.pointerType === 'mouse' && event.button !== 0) ||
        event.clientX > EDGE_SWIPE_START_PX ||
        document.querySelector('[aria-modal="true"], body.chart-fullscreen-open')
      ) {
        return;
      }

      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;

      if (!horizontal) {
        if (Math.abs(deltaY) > 10 && Math.abs(deltaY) > Math.abs(deltaX)) {
          reset();
          return;
        }
        if (deltaX <= 8 || deltaX <= Math.abs(deltaY)) return;
        horizontal = true;
        document.documentElement.classList.add('edge-swipe-active');
      }

      event.preventDefault();
      const progress = Math.max(0, Math.min(1, deltaX / EDGE_SWIPE_DISTANCE_PX));
      document.documentElement.style.setProperty('--edge-swipe-progress', String(progress));
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const completed = completesEdgeSwipe(event.clientX - startX, event.clientY - startY);
      reset();
      if (completed) onBackRef.current();
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId === pointerId) reset();
    };

    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', onPointerUp, { capture: true });
    window.addEventListener('pointercancel', onPointerCancel, { capture: true });
    return () => {
      reset();
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onPointerCancel, { capture: true });
    };
  }, [enabled]);

  return (
    <div className="edge-swipe-indicator" aria-hidden="true">
      <span>‹</span>
    </div>
  );
}
