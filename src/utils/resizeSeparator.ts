import type { KeyboardEvent } from 'react';

/**
 * Keyboard operation for a drag-to-resize separator.
 *
 * Both separators already carried `role="separator"`, which promises they can
 * be operated — but neither was focusable and neither answered a key, so the
 * panel and the drawer could only be resized with a pointer. The store clamps
 * every size it is given, so this only has to say which way and how far.
 */

/** One arrow press. Shift multiplies it, for crossing the panel quickly. */
export const RESIZE_STEP = 16;
const RESIZE_STEP_LARGE = 96;

export const separatorKeyDown = (
  orientation: 'horizontal' | 'vertical',
  current: number,
  resize: (next: number) => void,
) => (event: KeyboardEvent) => {
  // A horizontal separator is dragged up and down; a vertical one left and
  // right. Matches aria-orientation, which describes the separator itself
  // rather than the direction it travels.
  const [decrease, increase] =
    orientation === 'horizontal' ? ['ArrowDown', 'ArrowUp'] : ['ArrowLeft', 'ArrowRight'];
  if (event.key !== decrease && event.key !== increase) return;

  const step = event.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP;
  resize(current + (event.key === increase ? step : -step));
  // Or the page scrolls under the separator while it is being resized.
  event.preventDefault();
};
