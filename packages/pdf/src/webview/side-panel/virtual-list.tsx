import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  scrollToShow,
  visibleRange,
  type ItemRange,
} from "../../shared/list-window";

/** Items drawn beyond the view each side, so a scroll does not show empty space. */
const OVERSCAN = 3;

/** Ask a list to bring an item into view; a new object asks again. */
export interface RevealRequest {
  index: number;
}

export interface VirtualListProps {
  role: "tree" | "listbox";
  label: string;
  count: number;
  /** Where each item starts and the height of all of them last: `count + 1` numbers. */
  offsets: readonly number[];
  /** The item with the keyboard's focus, which the list names as its active descendant. */
  focusedId: string | undefined;
  reveal?: RevealRequest | undefined;
  /** An item to draw, placed by `style`. */
  renderItem: (index: number, style: CSSProperties) => React.ReactNode;
  /** A key in the list; `pageItems` is how many items a screenful holds. */
  onKeyDown: (event: React.KeyboardEvent, pageItems: number) => void;
  /** The items that are on screen or close, when they change. */
  onRange?: ((range: ItemRange) => void) | undefined;
  onFocus?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * A scrolling list that draws only the items in view. DOM focus stays on the
 * list itself and the focused item is its `aria-activedescendant`, as VS
 * Code's own lists do, so a screen reader hears the item and the keyboard
 * keeps working while items scroll in and out.
 */
export function VirtualList(props: VirtualListProps): React.JSX.Element {
  const { offsets, count, renderItem, onRange } = props;
  const element = useRef<HTMLDivElement>(null);
  const view = useScrollView(element);
  const range = visibleRange(offsets, view, OVERSCAN);
  const { first, end } = range;
  useEffect(() => {
    onRange?.({ first, end });
  }, [first, end, onRange]);
  useReveal(element, offsets, props.reveal);
  const pageItems = Math.max(
    1,
    Math.floor(view.height / Math.max(1, (offsets[count] ?? 0) / (count || 1))),
  );
  const items: React.ReactNode[] = [];
  for (let index = range.first; index < range.end; index += 1) {
    const top = offsets[index] ?? 0;
    const height = (offsets[index + 1] ?? top) - top;
    items.push(renderItem(index, { position: "absolute", top, height }));
  }
  return (
    <div
      ref={element}
      className={`sp-scroll ${props.className ?? ""}`}
      role={props.role}
      aria-label={props.label}
      tabIndex={0}
      aria-activedescendant={props.focusedId}
      onKeyDown={(event) => props.onKeyDown(event, pageItems)}
      onFocus={props.onFocus}
    >
      <div className="sp-spacer" style={{ height: offsets[count] ?? 0 }}>
        {items}
      </div>
    </div>
  );
}

/** The scroll position and height of the list's element, kept as it changes. */
function useScrollView(element: React.RefObject<HTMLDivElement | null>) {
  const [view, setView] = useState({ top: 0, height: 0 });
  const read = useCallback((): void => {
    const el = element.current;
    if (!el) {
      return;
    }
    setView((now) =>
      now.top === el.scrollTop && now.height === el.clientHeight
        ? now
        : { top: el.scrollTop, height: el.clientHeight },
    );
  }, [element]);
  useLayoutEffect(() => {
    const el = element.current;
    if (!el) {
      return;
    }
    read();
    el.addEventListener("scroll", read, { passive: true });
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", read);
      observer.disconnect();
    };
  }, [element, read]);
  return view;
}

/** Scroll an item into view when asked, by the least. */
function useReveal(
  element: React.RefObject<HTMLDivElement | null>,
  offsets: readonly number[],
  reveal: RevealRequest | undefined,
): void {
  const latest = useRef(offsets);
  latest.current = offsets;
  useLayoutEffect(() => {
    const el = element.current;
    if (!el || !reveal) {
      return;
    }
    const top = scrollToShow(latest.current, reveal.index, {
      top: el.scrollTop,
      height: el.clientHeight,
    });
    if (top !== el.scrollTop) {
      el.scrollTop = top;
    }
  }, [element, reveal]);
}
