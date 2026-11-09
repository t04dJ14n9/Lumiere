import { contributionId } from "../../shared/setting-schema";

/** Built-in Explorer Outline view (`IOutlinePane.Id`). */
export const NATIVE_OUTLINE_ID = "outline";

/**
 * Tags lives in another plugin; use the shared contribution id so this module
 * does not import tags internals.
 */
export const TAGS_VIEW_ID = contributionId("tags");

/** Lumiere custom editor view type. */
export const MARKDOWN_WORKSHOP_EDITOR = "lumiere.markdown.editor";

/** Lumiere PDF custom editor view type (peer product). */
export const PDF_WORKSHOP_EDITOR = "lumiere.pdf.viewer";

/**
 * Delay before restoring the native Outline after leaving a Workshop editor.
 * A short window lets a Lumiere PDF tab take over without flashing Outline.
 */
export const LEAVE_RESTORE_MS = 120;

export type OutlineFocusExecute = (command: string) => Promise<unknown>;

export type OutlineFocusSchedule = (
  run: () => void,
  ms: number,
) => { dispose: () => void };

export type OutlineFocusOptions = {
  execute: OutlineFocusExecute;
  /** Return keyboard focus to the editor after restoring the native Outline. */
  focusEditor: () => Promise<unknown>;
  /**
   * Whether Markdown Outline is on screen: in the Explorer, which is the
   * sidebar's container, and not collapsed. It is how this module learns the
   * Explorer is the container shown, without bringing it up.
   */
  isOutlineShown?: () => boolean;
  /**
   * Active tab's custom editor viewType, if any. Used to abort native Outline
   * restore when Markdown or Lumiere PDF already owns the sidebar swap.
   */
  activeCustomEditorViewType?: () => string | undefined;
  /** This product's custom editor id (defaults to Lumiere). */
  ownEditorViewType?: string;
  leaveDelayMs?: number;
  schedule?: OutlineFocusSchedule;
};

/** True when a Workshop custom editor (MW or PDF) is the active tab. */
export function workshopEditorOwnsOutline(
  viewType: string | undefined,
): boolean {
  return (
    viewType === MARKDOWN_WORKSHOP_EDITOR || viewType === PDF_WORKSHOP_EDITOR
  );
}

type FocusState = {
  engaged: boolean;
  /** The native Outline was hidden here and has not been restored yet. */
  nativeHidden: boolean;
  leave: { dispose: () => void } | undefined;
};

/**
 * One-shot sidebar swap while a Lumiere custom editor is active: Markdown
 * Outline replaces the native Outline, which comes back on leave (debounced
 * for Workshop↔PDF handoffs). Tags and other Explorer subpanels stay
 * collapsed.
 *
 * It never changes which sidebar container is shown. Markdown Outline is a
 * view of the Explorer, and VS Code's `<view>.focus` command reveals the
 * view's container: a note opened from Search or Quick Open swapped the
 * Search view for the Explorer. So the view is never asked for. VS Code shows
 * an extension's Explorer view collapsed the first time, whatever its
 * `visibility`, and remembers the reader's expanding it; from then on
 * Markdown Outline appears expanded wherever the Explorer is the container.
 * The native Outline is hidden once it does: `outline.removeView` only acts
 * while the Explorer is the container shown, so asking before that would do
 * nothing. It is restored only if it was hidden.
 */
export function createOutlineFocus(options: OutlineFocusOptions): {
  sync: (workshopActive: boolean) => void;
  /** Markdown Outline has just become visible. */
  outlineShown: () => void;
  dispose: () => void;
} {
  const resolved = resolveOptions(options);
  const state: FocusState = {
    engaged: false,
    nativeHidden: false,
    leave: undefined,
  };
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>): void => {
    queue = queue.then(task, task);
  };

  return {
    sync(workshopActive) {
      if (workshopActive) {
        enterFocus(state, resolved, enqueue);
        return;
      }
      scheduleLeave(state, resolved, enqueue);
    },
    outlineShown() {
      if (state.engaged) {
        hideNativeOutline(state, resolved, enqueue);
      }
    },
    dispose() {
      state.leave?.dispose();
      state.leave = undefined;
      state.engaged = false;
      if (!state.nativeHidden) {
        return;
      }
      state.nativeHidden = false;
      enqueue(async () => {
        await restoreNativeOutline(resolved, "dispose");
      });
    },
  };
}

type ResolvedFocus = {
  execute: OutlineFocusExecute;
  focusEditor: () => Promise<unknown>;
  isOutlineShown: () => boolean;
  activeViewType: () => string | undefined;
  ownEditorViewType: string;
  leaveDelayMs: number;
  schedule: OutlineFocusSchedule;
};

function resolveOptions(options: OutlineFocusOptions): ResolvedFocus {
  return {
    execute: options.execute,
    focusEditor: options.focusEditor,
    isOutlineShown: () => options.isOutlineShown?.() ?? false,
    activeViewType: () => options.activeCustomEditorViewType?.(),
    ownEditorViewType: options.ownEditorViewType ?? MARKDOWN_WORKSHOP_EDITOR,
    leaveDelayMs: options.leaveDelayMs ?? LEAVE_RESTORE_MS,
    schedule: options.schedule ?? defaultSchedule,
  };
}

function enterFocus(
  state: FocusState,
  options: ResolvedFocus,
  enqueue: (task: () => Promise<void>) => void,
): void {
  state.leave?.dispose();
  state.leave = undefined;
  if (state.engaged) {
    return;
  }
  state.engaged = true;
  // The editor can become active after its Outline is already on screen.
  if (options.isOutlineShown()) {
    hideNativeOutline(state, options, enqueue);
  }
}

/** Hide the native Outline, once, now that the Explorer is known to show. */
function hideNativeOutline(
  state: FocusState,
  options: ResolvedFocus,
  enqueue: (task: () => Promise<void>) => void,
): void {
  if (state.nativeHidden) {
    return;
  }
  state.nativeHidden = true;
  enqueue(async () => {
    await options.execute(`${NATIVE_OUTLINE_ID}.removeView`);
  });
}

function scheduleLeave(
  state: FocusState,
  options: ResolvedFocus,
  enqueue: (task: () => Promise<void>) => void,
): void {
  if (!state.engaged || state.leave) {
    return;
  }
  state.leave = options.schedule(() => {
    state.leave = undefined;
    if (!state.engaged) {
      return;
    }
    state.engaged = false;
    if (!state.nativeHidden) {
      return;
    }
    state.nativeHidden = false;
    enqueue(async () => {
      await restoreNativeOutline(options, "leave");
    });
  }, options.leaveDelayMs);
}

async function restoreNativeOutline(
  options: ResolvedFocus,
  reason: "leave" | "dispose",
): Promise<void> {
  const active = options.activeViewType();
  if (reason === "leave" && workshopEditorOwnsOutline(active)) {
    // Peer (or this product again) owns the sidebar; do not undo their hide.
    return;
  }
  if (
    reason === "dispose" &&
    workshopEditorOwnsOutline(active) &&
    active !== options.ownEditorViewType
  ) {
    // Peer Workshop owns the swap; leave native Outline to them.
    return;
  }
  try {
    // Showing a hidden view means focusing it, which also brings up the
    // Explorer. Only the native Outline this module hid is worth that.
    await options.execute(`${NATIVE_OUTLINE_ID}.focus`);
    if (reason === "leave") {
      await options.focusEditor();
    }
  } catch (error) {
    // Dispose runs from an effect cleanup; the queued restore can land after
    // the host context has already rejected further execute calls.
    if (reason === "dispose") {
      return;
    }
    throw error;
  }
}

function defaultSchedule(run: () => void, ms: number): { dispose: () => void } {
  const timer = setTimeout(run, ms);
  return {
    dispose() {
      clearTimeout(timer);
    },
  };
}
