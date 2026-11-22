import { useEffect, useRef } from "react";
import { keyMove, swappedArrow, type KeyContext } from "../shared/paging-keys";
import { currentViewSettings } from "./reading-position";
import type { ScrollDirection, ScrollMode } from "../shared/view-settings";
import { useStageApi, type StageApi } from "./stage-capability";

/** Elements that keep the arrow keys for themselves (text, numbers, menus). */
const OWN_KEYS =
  'input, textarea, select, [contenteditable], [role="slider"], [role="spinbutton"], [role="listbox"], [role="menu"], [role="combobox"], .view-menu, .side-panel';

export interface PagingInput {
  mode: ScrollMode;
  direction: ScrollDirection;
  /** Turn to the next (1) or previous (-1) page or spread; with `keepPlace`, at the same place in it. */
  step: (delta: 1 | -1, keepPlace?: boolean) => void;
}

const MAC = /Mac|iPhone|iPad/u.test(navigator.userAgent);

/**
 * Arrow and Page keys, wherever focus is in the viewer (right after opening,
 * after a click on a page, or after a toolbar button or the View picker took
 * it): pan while there is room, else turn the page; see `keyMove`. Keys with a
 * modifier stay with VS Code and the extension's own shortcuts, except that
 * `arrowsKeepPlace` swaps plain and ⌥ Left/Right (see `swappedArrow`).
 *
 * The Stage has no keyboard scrolling of its own, so this pans it by the
 * room its scroll metrics report.
 */
export function usePagingKeys(input: PagingInput): void {
  const stage = useStageApi();
  const latest = useRef({ input, stage });
  latest.current = { input, stage };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const { input, stage } = latest.current;
      if (
        event.defaultPrevented ||
        (event.target instanceof Element && event.target.closest(OWN_KEYS)) ||
        handledBeforePanning(event, input.step)
      ) {
        return;
      }
      const move = keyMove(event.key, keyContext(stage, input));
      if (!move) {
        return;
      }
      event.preventDefault();
      if (move.type === "page") {
        input.step(move.delta);
      } else {
        stage.scrollBy({ left: move.x, top: move.y, behavior: "instant" });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** What the viewer can do from where it stands: the room it has to scroll each way. */
function keyContext(stage: StageApi, input: PagingInput): KeyContext {
  const view = stage.getScrollMetrics();
  return {
    mode: input.mode,
    direction: input.direction,
    width: view.clientWidth,
    height: view.clientHeight,
    room: {
      left: view.scrollLeft,
      right: view.scrollWidth - view.clientWidth - view.scrollLeft,
      up: view.scrollTop,
      down: view.scrollHeight - view.clientHeight - view.scrollTop,
    },
    overflowsX: view.scrollableX,
  };
}

/**
 * Whether a key is done with before panning: with `arrowsKeepPlace` a plain
 * Left/Right turns the page keeping the place here, and other modified keys
 * belong to VS Code (a swapped ⌥Left/Right goes on to pan like a plain one).
 */
function handledBeforePanning(
  event: KeyboardEvent,
  step: PagingInput["step"],
): boolean {
  const swapped = currentViewSettings().arrowsKeepPlace
    ? swappedArrow(event.key, event, MAC)
    : undefined;
  if (swapped?.type === "keepPlace") {
    event.preventDefault();
    step(swapped.delta, true);
    return true;
  }
  return (
    !swapped &&
    (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
  );
}
