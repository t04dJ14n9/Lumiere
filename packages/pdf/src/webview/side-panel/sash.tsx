import React, { useRef } from "react";
import {
  DEFAULT_SIDE_PANEL_WIDTH,
  MAX_SIDE_PANEL_WIDTH,
  MIN_SIDE_PANEL_WIDTH,
} from "../../shared/side-panel";
import { t } from "@workshop/l10n";

/** A key press moves the sash this far; Shift moves it further. */
const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;

/**
 * The edge of the panel, which is dragged to resize it: a four-pixel strip
 * that shows the theme's sash colour under the pointer, as VS Code's sashes
 * do. With the keyboard, Left and Right move it and Enter or a double click
 * puts it back. `onResize` is called as the width changes; `onCommit` when
 * the reader is done (the pointer is let go, a key is pressed).
 */
export function Sash({
  width,
  onResize,
  onCommit,
}: {
  width: number;
  onResize: (width: number) => void;
  onCommit: (width: number) => void;
}): React.JSX.Element {
  const drag = useRef<{ x: number; width: number; moved: boolean } | undefined>(
    undefined,
  );
  const last = useRef(width);
  last.current = width;
  // A press that moved nothing saves nothing: the width drawn may be less
  // than the reader's saved one, in a narrow viewer.
  const end = (): void => {
    const moved = drag.current?.moved;
    drag.current = undefined;
    if (moved) {
      onCommit(last.current);
    }
  };
  return (
    <div
      className="sp-sash"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("Resize Side Panel")}
      aria-valuenow={width}
      aria-valuemin={MIN_SIDE_PANEL_WIDTH}
      aria-valuemax={MAX_SIDE_PANEL_WIDTH}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button === 0) {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, width, moved: false };
        }
      }}
      onPointerMove={(event) => {
        if (drag.current) {
          drag.current.moved = true;
          onResize(drag.current.width + event.clientX - drag.current.x);
        }
      }}
      onPointerUp={() => end()}
      onPointerCancel={() => end()}
      onDoubleClick={() => onCommit(DEFAULT_SIDE_PANEL_WIDTH)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
        const next = sashKey(event.key, width, step);
        if (next !== undefined) {
          event.preventDefault();
          onCommit(next);
        }
      }}
    />
  );
}

/** The width a key asks for, or undefined when it is not a sash key. */
function sashKey(key: string, width: number, step: number): number | undefined {
  switch (key) {
    case "ArrowLeft":
      return width - step;
    case "ArrowRight":
      return width + step;
    case "Home":
      return MIN_SIDE_PANEL_WIDTH;
    case "End":
      return MAX_SIDE_PANEL_WIDTH;
    case "Enter":
      return DEFAULT_SIDE_PANEL_WIDTH;
    default:
      return undefined;
  }
}
