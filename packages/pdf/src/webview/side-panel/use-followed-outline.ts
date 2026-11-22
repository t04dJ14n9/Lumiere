import { useStageEvent } from "@embedpdf/react/stage";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OutlineItem } from "../../shared/messages";
import { findActiveOutlineItem } from "../../shared/outline";
import {
  followedBranches,
  outlineRowIdOf,
  type OutlineRowId,
} from "../../shared/outline-tree";
import { useStageApi } from "../stage-capability";
import { readingPlace } from "../stage-position";

/**
 * How long after a click on a bookmark the tree is left as it is: its
 * branches would close under the pointer and a double-click's second click
 * would land on another bookmark (the Explorer's outline waits the same).
 */
const CLICK_HOLD_MS = 1000;

export interface FollowedOutline {
  /** The bookmark of the reading position, while Follow Cursor is on. */
  id: OutlineRowId | undefined;
  /** Asks the tree to show that bookmark, each time it changes. */
  reveal: { id: OutlineRowId } | undefined;
}

/**
 * Follow Cursor for the side panel's outline: as the reader moves, find the
 * bookmark of the reading position (`findActiveOutlineItem`, the rule the
 * Explorer's view follows), open its parents and its own sub-bookmarks and
 * close the other branches (`onFollow`). Does nothing while off.
 */
export function useFollowedOutline(options: {
  items: readonly OutlineItem[] | undefined;
  enabled: boolean;
  onFollow: (branches: ReadonlySet<OutlineRowId>) => void;
  /** A new object for each click on a bookmark. */
  clicked: object | undefined;
}): FollowedOutline {
  const { items, enabled, onFollow, clicked } = options;
  const stage = useStageApi();
  const [followed, setFollowed] = useState<FollowedOutline>({
    id: undefined,
    reveal: undefined,
  });
  const heldUntil = useRef(0);
  useEffect(() => {
    if (clicked) {
      heldUntil.current = Date.now() + CLICK_HOLD_MS;
    }
  }, [clicked]);
  // What was last followed, to say only a change. A new outline starts over.
  const last = useRef<OutlineRowId | undefined>(undefined);
  useEffect(() => {
    last.current = undefined;
  }, [items, enabled]);
  const follow = useCallback((): void => {
    if (!enabled || !items) {
      return;
    }
    const place = readingPlace(stage);
    const item =
      place &&
      findActiveOutlineItem(items, { page: place.page, top: place.top });
    const id = outlineRowIdOf(items, item);
    if (id === last.current) {
      return;
    }
    last.current = id;
    setFollowed({ id, reveal: id === undefined ? undefined : { id } });
    onFollow(followedBranches(items, id));
  }, [enabled, items, stage, onFollow]);
  const soon = useCoalescedFrame(follow, heldUntil);
  useEffect(soon, [soon]);
  useStageEvent((stage) => stage.onCameraChanged, soon);
  return enabled ? followed : { id: undefined, reveal: undefined };
}

/**
 * `run` on the next frame, at most once however often it is asked, and not
 * before the hold is over.
 */
function useCoalescedFrame(
  run: () => void,
  heldUntil: React.RefObject<number>,
): () => void {
  const timer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(() => {
    window.clearTimeout(timer.current);
    const wait = Math.max(16, heldUntil.current - Date.now());
    timer.current = window.setTimeout(run, wait);
  }, [run, heldUntil]);
}
