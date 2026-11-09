import { usePage } from "@embedpdf/react/runtime";
import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { registerLookUpPage } from "./look-up-pages";
import {
  lookUpTarget,
  onLookUpTargetChange,
  type LookUpTarget,
} from "./look-up-target";

/**
 * The word under the pointer as real, invisible text over its picture, for
 * macOS Look Up.
 *
 * A force click (or a three-finger tap) asks Chromium for the text under the
 * pointer, and Chromium reads it from the DOM; webpages are never told about
 * the force itself. The page is a picture, so there was nothing to find. This
 * span puts the word there, stretched over the word's glyphs, so the system
 * shows its own Dictionary popover.
 *
 * It sits just above the picture and below the links and the annotation
 * layer, so those keep their clicks; the pointer events it takes bubble to the
 * Stage, which reads positions against the page, not the element pressed.
 * look-up.ts keeps the browser from starting a text selection in it.
 *
 * Each page layer also says where its page is, which is how look-up.ts finds
 * the page under the pointer.
 */
export function LookUpWord(): React.JSX.Element | null {
  const page = usePage();
  const scale = page.transform.viewScale;
  const target = useSyncExternalStore(onLookUpTargetChange, lookUpTarget);
  const shown = target?.pageIndex === page.pageIndex ? target : undefined;
  const span = useRef<HTMLSpanElement>(null);
  // The page's transform changes with every zoom: the registered page reads
  // the latest one, so a zoom does not register it again.
  const latest = useRef(page);
  latest.current = page;
  useEffect(
    () =>
      registerLookUpPage({
        pageIndex: page.pageIndex,
        ref: page.ref,
        get size() {
          const { contentWidth, contentHeight, viewScale } =
            latest.current.transform;
          return {
            width: contentWidth / viewScale,
            height: contentHeight / viewScale,
          };
        },
        toPagePoint: (x, y) => latest.current.toPagePoint(x, y),
      }),
    [page.pageIndex, page.ref],
  );
  useLayoutEffect(() => {
    if (span.current && shown) {
      fitToBox(span.current, shown.box, scale);
    }
  }, [shown, scale]);
  if (!shown) {
    return null;
  }
  const [left, top, , bottom] = shown.box;
  const height = (bottom - top) * scale;
  return (
    <span
      ref={span}
      className="look-up-word"
      aria-hidden="true"
      style={{
        left: left * scale,
        top: top * scale,
        fontSize: height,
        lineHeight: `${height}px`,
      }}
    >
      {shown.text}
    </span>
  );
}

/**
 * Stretch the text over the word's box: the system finds a character only
 * where one is drawn, and Look Up anchors its popover on the text's baseline.
 */
function fitToBox(
  span: HTMLElement,
  [left, top, right, bottom]: LookUpTarget["box"],
  scale: number,
): void {
  span.style.transform = "";
  const width = span.offsetWidth;
  const height = span.offsetHeight;
  if (!width || !height) {
    return;
  }
  const scaleX = ((right - left) * scale) / width;
  const scaleY = ((bottom - top) * scale) / height;
  span.style.transform = `scale(${scaleX}, ${scaleY})`;
}
