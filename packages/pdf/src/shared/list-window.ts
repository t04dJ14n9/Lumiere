/**
 * Which items of a long list are on screen: the side panel draws only those
 * (and a few around them), so a thousand-page PDF's thumbnails, or a few
 * thousand marks, cost no more to scroll than ten.
 */

/** Items `first` up to, not including, `end`. */
export interface ItemRange {
  first: number;
  end: number;
}

/** The tops of `count` items of one height, then the height of them all. */
export function fixedOffsets(count: number, itemHeight: number): number[] {
  return Array.from({ length: count + 1 }, (_, index) => index * itemHeight);
}

/**
 * The items a view of `height` pixels starting `top` pixels down shows, plus
 * `overscan` more items each side. `offsets[i]` is where item `i` starts, and
 * the last entry is the height of the whole list, so `offsets` holds one more
 * entry than there are items.
 */
export function visibleRange(
  offsets: readonly number[],
  view: { top: number; height: number },
  overscan = 0,
): ItemRange {
  const count = offsets.length - 1;
  if (count <= 0) {
    return { first: 0, end: 0 };
  }
  // The first item that ends below the view's top, and the first that starts
  // at or below its bottom.
  const first = firstWhere(count, (item) => offsets[item + 1]! > view.top);
  const end = firstWhere(
    count,
    (item) => offsets[item]! >= view.top + view.height,
  );
  return {
    first: Math.max(0, first - overscan),
    end: Math.min(count, Math.max(end, first + 1) + overscan),
  };
}

/** The lowest item in `0..count` for which `test` holds (`count` when none does); `test` must flip once. */
function firstWhere(count: number, test: (item: number) => boolean): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (test(middle)) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

/**
 * How far to scroll so item `index` is fully in a view, by the least: not at
 * all when it already is. An item taller than the view lines up at its top.
 */
export function scrollToShow(
  offsets: readonly number[],
  index: number,
  view: { top: number; height: number },
): number {
  const start = offsets[index];
  const end = offsets[index + 1];
  if (start === undefined || end === undefined) {
    return view.top;
  }
  if (start < view.top || end - start > view.height) {
    return start;
  }
  return end > view.top + view.height ? end - view.height : view.top;
}
