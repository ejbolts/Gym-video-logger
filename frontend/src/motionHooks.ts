import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { motionReduced } from './motion';

const ACTIVE_CHILD =
  ':scope > .active, :scope > [aria-checked="true"], :scope > [aria-selected="true"]';

/**
 * Positions a shared highlight (the container's ::before) under the active child so it can glide
 * between options like an iOS segmented control. Pair with the `slide-indicator` class.
 */
export function useSlidingIndicator<T extends HTMLElement>(
  activeKey: unknown,
): (element: T | null) => void {
  // A callback ref, so controls that mount after data loads are still measured.
  const [container, setContainer] = useState<T | null>(null);

  useLayoutEffect(() => {
    if (!container) return;
    let frame = 0;

    const place = () => {
      const active = container.querySelector<HTMLElement>(ACTIVE_CHILD);
      if (!active || container.offsetWidth === 0) {
        // Hidden screens report zero sizes; re-enter without sliding from a stale position.
        delete container.dataset.indicatorReady;
        container.style.setProperty('--indicator-opacity', '0');
        return;
      }
      container.style.setProperty('--indicator-x', `${active.offsetLeft}px`);
      container.style.setProperty('--indicator-y', `${active.offsetTop}px`);
      container.style.setProperty('--indicator-w', `${active.offsetWidth}px`);
      container.style.setProperty('--indicator-h', `${active.offsetHeight}px`);
      container.style.setProperty('--indicator-opacity', '1');
      if (!container.dataset.indicatorReady) {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => {
          container.dataset.indicatorReady = 'true';
        });
      }
    };

    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(container);
    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [activeKey, container]);

  return setContainer;
}

const MOVE_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/**
 * FLIP animation for keyed lists: when `orderKey` changes (reorder, insert, delete), elements
 * marked with `data-flip-key` glide from their previous position and new ones fade in.
 */
export function useFlipAnimation(containerRef: RefObject<HTMLElement | null>, orderKey: string) {
  const positions = useRef(new Map<string, number>());
  const previousOrder = useRef(orderKey);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (container.offsetWidth === 0) {
      // Hidden screens measure as zero; start fresh once visible.
      positions.current = new Map();
      previousOrder.current = orderKey;
      return;
    }
    const origin = container.getBoundingClientRect().top;
    const elements = [...container.querySelectorAll<HTMLElement>('[data-flip-key]')];
    const next = new Map<string, number>();
    elements.forEach((element) => {
      next.set(element.dataset.flipKey!, element.getBoundingClientRect().top - origin);
    });

    const orderChanged = previousOrder.current !== orderKey;
    const measuredBefore = positions.current.size > 0;
    if (orderChanged && measuredBefore && !motionReduced()) {
      elements.forEach((element) => {
        if (typeof element.animate !== 'function') return;
        const key = element.dataset.flipKey!;
        const before = positions.current.get(key);
        if (before === undefined) {
          element.animate(
            [
              { opacity: 0, transform: 'translateY(-8px)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 240, easing: MOVE_EASING },
          );
          return;
        }
        const offset = before - next.get(key)!;
        if (Math.abs(offset) < 1) return;
        element.animate([{ transform: `translateY(${offset}px)` }, { transform: 'none' }], {
          duration: 320,
          easing: MOVE_EASING,
        });
      });
    }

    positions.current = next;
    previousOrder.current = orderKey;
  });
}
