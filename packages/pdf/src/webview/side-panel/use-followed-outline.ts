import { useStageEvent } from "@embedpdf/react/stage";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OutlineItem } from "../../shared/messages";
import { findActiveOutlineItem } from "../../shared/outline";
import { CLICK_HOLD_MS, OutlineClickHold } from "../../shared/outline-click";
import {
  followedBranches,
  outlineRowIdOf,
  type OutlineRowId,
} from "../../shared/outline-tree";
import { currentViewSettings } from "../reading-position";
import { useStageApi } from "../stage-capability";
import { readingPlace } from "../stage-position";

export interface FollowedOutline {
  /**
   * The row to show as selected: the one clicked, until the reader moves on
   * from where the click landed (`OutlineClickHold`), else the bookmark of the
   * reading position while Follow Cursor is on.
   */
  id: OutlineRowId | undefined;
  /** Asks the tree to show that bookmark, each time it changes. */
  reveal: { id: OutlineRowId } | undefined;
  /** A row was clicked. */
  click: (id: OutlineRowId) => void;
}

const NONE = { id: undefined, reveal: undefined } as const;

/**
 * Follow Cursor for the side panel's outline: as the reader moves, find the
 * bookmark of the reading position (`findActiveOutlineItem`, the rule the
 * Explorer's view follows), open its parents and its own sub-bookmarks and
 * close the other branches (`onFollow`). The setting is read at each move, so
 * a change takes effect at the next one, however the reader moves. A click
 * leaves the tree alone until the reader moves on from it.
 */
export function useFollowedOutline(options: {
  items: readonly OutlineItem[] | undefined;
  onFollow: (branches: ReadonlySet<OutlineRowId>) => void;
}): FollowedOutline {
  const { items, onFollow } = options;
  const stage = useStageApi();
  const [hold] = useState(() => new OutlineClickHold());
  const [clicked, setClicked] = useState<OutlineRowId>();
  const [followed, setFollowed] = useState<{
    id: OutlineRowId | undefined;
    reveal: { id: OutlineRowId } | undefined;
  }>(NONE);
  // What was last followed, to say only a change. A new outline starts over.
  const last = useRef<OutlineRowId | undefined>(undefined);
  useEffect(() => {
    last.current = undefined;
  }, [items]);
  const later = useLater();
  const follow = useCallback((): void => {
    if (!items) {
      return;
    }
    if (currentViewSettings().outlineFollowCursor === false) {
      last.current = undefined;
      setFollowed(NONE);
      return;
    }
    const id = activeRowId(items, stage);
    const step = hold.step(id, Date.now());
    setClicked(hold.clickedId);
    if (step.kind === "wait") {
      later(follow, step.ms);
    } else if (step.kind === "follow" && id !== last.current) {
      last.current = id;
      setFollowed({ id, reveal: id === undefined ? undefined : { id } });
      onFollow(followedBranches(items, id));
    }
  }, [items, stage, hold, later, onFollow]);
  const soon = useCallback((): void => later(follow, 16), [later, follow]);
  useEffect(soon, [soon]);
  useStageEvent((stage) => stage.onCameraChanged, soon);
  const click = useCallback(
    (id: OutlineRowId): void => {
      hold.click(id, Date.now());
      setClicked(id);
      // The tree is now as the click left it, not as following left it: the
      // next bookmark followed, even the one followed last, is applied anew.
      last.current = undefined;
      // Where the click landed is read when the jump has had its time, even
      // if the view never moves (a heading that only groups others).
      later(follow, CLICK_HOLD_MS);
    },
    [hold, later, follow],
  );
  return { id: clicked ?? followed.id, reveal: followed.reveal, click };
}

/** The row of the bookmark the reader's position is at, if it is at one. */
function activeRowId(
  items: readonly OutlineItem[],
  stage: Parameters<typeof readingPlace>[0],
): OutlineRowId | undefined {
  const place = readingPlace(stage);
  const item =
    place && findActiveOutlineItem(items, { page: place.page, top: place.top });
  return outlineRowIdOf(items, item);
}

/** Run something after a delay, replacing what was waiting; nothing runs once the viewer is gone. */
function useLater(): (run: () => void, ms: number) => void {
  const timer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );
  return useCallback((run, ms) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(run, ms);
  }, []);
}
