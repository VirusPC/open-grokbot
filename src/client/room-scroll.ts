/**
 * Scroll offset that puts the bottom of the peers thread against the bottom
 * of the scroller.
 *
 * The previous helper only added a positive delta and returned early when
 * the tail was already above the view. Enter in the in-flow composer could
 * jump `scrollTop` into the blank region under the thread, and that jump
 * was left in place. This always clamps to the real content end.
 */
export function pinRoomScrollTop(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  void scrollTop;
  return Math.max(0, scrollHeight - clientHeight);
}
