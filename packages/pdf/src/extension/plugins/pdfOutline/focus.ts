/** Built-in Explorer Outline view (`IOutlinePane.Id`). */
export const NATIVE_OUTLINE_ID = "outline";

/** Lumiere PDF custom editor view type. */
export const PDF_LUMIERE_EDITOR = "lumiere.pdf.viewer";

/** Lumiere custom editor view type (peer product). */
export const MARKDOWN_LUMIERE_EDITOR = "lumiere.markdown.editor";

/**
 * Delay before restoring the native Outline after leaving a Lumiere PDF
 * editor. Lets a Lumiere tab take over without flashing Outline.
 */
export const LEAVE_RESTORE_MS = 120;

export type OutlineFocusExecute = (command: string) => Thenable<unknown>;

export type OutlineFocusSchedule = (
  run: () => void,
  ms: number,
) => { dispose: () => void };

export type OutlineFocusOptions = {
  execute: OutlineFocusExecute;
  /** Return keyboard focus to the editor after restoring the native Outline. */
  focusEditor: () => Thenable<unknown>;
  /**
   * Whether PDF Outline is on screen: in the Explorer, which is the
   * sidebar's container, and not collapsed. It is how this module learns the
   * Explorer is the container shown, without bringing it up.
   */
  isOutlineShown?: () => boolean;
  /**
   * Active tab's custom editor viewType, if any. Used to abort native Outline
   * restore when Markdown or Lumiere PDF already owns the sidebar swap.
   */
  activeCustomEditorViewType?: () => string | undefined;
  /** This product's custom editor id (defaults to Lumiere PDF). */
  ownEditorViewType?: string;
  leaveDelayMs?: number;
  schedule?: OutlineFocusSchedule;
};

/** True when a Lumiere custom editor (MW or PDF) is the active tab. */
export function lumiereEditorOwnsOutline(
  viewType: string | undefined,
): boolean {
  return (
    viewType === MARKDOWN_LUMIERE_EDITOR || viewType === PDF_LUMIERE_EDITOR
  );
}

type FocusState = {
  engaged: boolean;
  /** The native Outline was hidden here and has not been restored yet. */
  nativeHidden: boolean;
  leave: { dispose: () => void } | undefined;
};

type ResolvedFocus = {
  execute: OutlineFocusExecute;
  focusEditor: () => Thenable<unknown>;
  isOutlineShown: () => boolean;
  activeViewType: () => string | undefined;
  ownEditorViewType: string;
  leaveDelayMs: number;
  schedule: OutlineFocusSchedule;
};

/**
 * One-shot sidebar swap while a Lumiere PDF custom editor is active: PDF
 * Outline replaces the native Outline, which comes back on leave (debounced
 * for Lumiere↔Markdown handoffs).
 *
 * It never changes which sidebar container is shown, as the Markdown
 * product's outline does. PDF Outline is a view of the Explorer, and VS
 * Code's `<view>.focus` command reveals the view's container: a PDF opened
 * from Search or Quick Open swapped the Search view for the Explorer. So the
 * view is never asked for; it shows itself wherever the Explorer is the
 * container. The native Outline is hidden once it does: `outline.removeView`
 * only acts while the Explorer is the container shown, so asking before that
 * would do nothing. It is restored only if it was hidden.
 */
export function createOutlineFocus(options: OutlineFocusOptions): {
  sync: (pdfActive: boolean) => void;
  /** PDF Outline has just become visible. */
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
    sync(pdfActive) {
      if (pdfActive) {
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

function resolveOptions(options: OutlineFocusOptions): ResolvedFocus {
  return {
    execute: options.execute,
    focusEditor: options.focusEditor,
    isOutlineShown: () => options.isOutlineShown?.() ?? false,
    activeViewType: () => options.activeCustomEditorViewType?.(),
    ownEditorViewType: options.ownEditorViewType ?? PDF_LUMIERE_EDITOR,
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
  if (reason === "leave" && lumiereEditorOwnsOutline(active)) {
    return;
  }
  if (
    reason === "dispose" &&
    lumiereEditorOwnsOutline(active) &&
    active !== options.ownEditorViewType
  ) {
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
    // Dispose runs while the extension stops; the queued restore can land
    // after VS Code has stopped taking commands from it.
    if (reason === "dispose") {
      return;
    }
    throw error;
  }
}

function defaultSchedule(run: () => void, ms: number): { dispose: () => void } {
  const timer = setTimeout(run, ms);
  return { dispose: () => clearTimeout(timer) };
}
