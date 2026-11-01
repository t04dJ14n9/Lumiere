import React, { useLayoutEffect, useRef, useSyncExternalStore } from "react";
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
 * page, where EmbedPDF reads positions against the page box. look-up.ts keeps
 * the browser from starting a text selection in it.
 */
export function LookUpWord({
  pageIndex,
  scale,
}: {
  pageIndex: number;
  scale: number;
}): React.JSX.Element | null {
  const target = useSyncExternalStore(onLookUpTargetChange, lookUpTarget);
  const shown = target?.pageIndex === pageIndex ? target : undefined;
  const span = useRef<HTMLSpanElement>(null);
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
