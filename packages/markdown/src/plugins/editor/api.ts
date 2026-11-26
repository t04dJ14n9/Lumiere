import type { RuntimePluginState } from "../../shared/plugin-state";
import type { config as editorConfig } from "./manifest";
import type { Cancellation } from "../../shared/rpc/lifecycle";
import type { ViewStateContributions } from "./contributions";
import type { Infer, Disposer } from "@workshop/core";
import type { viewState } from "./protocol";
import type { DocumentSession } from "../document/api";
import {
  Annotation,
  Compartment,
  EditorState,
  Facet,
  type Extension,
  type StateEffect,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { PanelPort } from "../../shared/host";
import type { CaretMode, VimCaretProfile } from "./caret";
export type { CaretMode, VimCaretProfile } from "./caret";

/**
 * Marks a transaction that only publishes background work on the document,
 * such as a parse that finished. Nothing in it is view state, so the editor
 * saves no view state for it.
 */
export const backgroundUpdate = Annotation.define<boolean>();

/**
 * How tall the chrome a plugin pins over the top of the note (the sticky
 * headings) will be once the line at `position` is the first one below it,
 * 0 when there is none. A jump leaves that much room above its target in the
 * first scroll: the chrome on screen belongs to the place the jump leaves,
 * and measuring it after the jump has drawn it would take a second scroll,
 * with the first one's row count (the bar can flip between 3 rows and 2 as
 * the line moves) to correct. Every contribution counts the whole chrome, so
 * the tallest is used.
 */
export const pinnedChromeHeight = Facet.define<
  (view: EditorView, position: number) => number,
  (view: EditorView, position: number) => number
>({
  combine: (heights) => (view, position) =>
    Math.max(0, ...heights.map((height) => height(view, position))),
});

/**
 * A nested editor, such as a table cell's, is a view of its own whose state
 * does not share the note's facets, and editing commands and typing check
 * the state they run on (`EditorState.readOnly`). The editor owns the note's
 * read-only state (features may not set it: composition-policy.test.ts), so
 * a nested editor takes a copy from here: the note's when it opens
 * (`noteReadOnly`), and the note's again whenever that changes
 * (`followNoteReadOnly`). The note turns read-only when syncing fails for
 * good (document/sync.ts).
 */
const nestedReadOnly = new Compartment();

/**
 * Marks a transaction that brings a nested editor's text to the note's (the
 * note changed under it, or it moved to another cell): not an edit, so it
 * applies while the note is read-only.
 */
export const nestedSync = Annotation.define<boolean>();

/**
 * A nested editor's read-only state: the note's when it opens. The facet
 * only advises commands, so a change dispatched to the nested editor anyway
 * (a key handler's or a menu's) is dropped while the note is read-only;
 * otherwise the nested editor would show text the note never gets.
 */
export function noteReadOnly(note: EditorState): Extension {
  return [
    nestedReadOnly.of(EditorState.readOnly.of(note.readOnly)),
    EditorState.transactionFilter.of((transaction) =>
      transaction.docChanged &&
      transaction.startState.readOnly &&
      !transaction.annotation(nestedSync)
        ? []
        : transaction,
    ),
  ];
}

/** What makes a nested editor read-only exactly when the note is, if needed. */
export function followNoteReadOnly(
  nested: EditorState,
  note: EditorState,
): TransactionSpec | undefined {
  if (nested.readOnly === note.readOnly) {
    return undefined;
  }
  return {
    effects: nestedReadOnly.reconfigure(EditorState.readOnly.of(note.readOnly)),
  };
}
export interface CaretModeSource {
  mode(view: EditorView): CaretMode;
  /** Vim caret look; omit for VSCodeVim-shaped modes (legacy). */
  profile?(view: EditorView): VimCaretProfile;
  watch?(view: EditorView, refresh: () => void): () => void;
}
export interface MenuItem {
  label: string;
  run?: () => void | Promise<void>;
  children?: readonly MenuItem[];
  disabled?: boolean;
  checked?: boolean;
}
export interface Menu {
  open(
    owner: EditorView["dom"],
    items: readonly MenuItem[],
    point: { x: number; y: number },
    label?: string,
  ): Disposer;
}
/** A line held below the top of the viewport while the layout settles. */
export interface ScrollHold {
  /**
   * Hold it `yMargin` px below the top instead, scrolled there at once (the
   * measuring is run now, not in the next frame); false once the hold has
   * ended.
   */
  move(yMargin: number): boolean;
  /** Whether the hold is still keeping the line in place. */
  isHeld(): boolean;
}
export interface EditorService {
  readonly settings: Infer<typeof editorConfig>;
  /** Own a modal caret source through the same extension registration as its keys. */
  caret(source: CaretModeSource): Extension;
  /**
   * How the note draws a selection (a rounded tint, squared where the caret
   * meets it), for a nested editor to draw its own the same way. Pair it
   * with `drawSelection()`, which hides the browser's selection.
   */
  readonly selection: Extension;
  readonly clipboard: {
    read(): Promise<string>;
    write(text: string): Promise<void>;
  };
  mode: "source" | "livePreview";
  readonly source: string;
  readonly viewState: ViewStateContributions;
  readonly view: EditorView;
  extend(
    extension: Extension,
    options?: {
      slot?: "override" | "suggest" | "keymap" | "base";
      owner?: string;
    },
  ): Disposer;
  /** Record a deliberate jump, excluding ordinary editing and cursor motion. */
  navigate<T>(jump: () => T): T;
  /**
   * Hold the line of `position` `yMargin` px below the top of the viewport
   * (as `EditorView.scrollIntoView` with `y: "start"` and that margin would
   * place it) for the next scroll to `position`, and keep it there while the
   * layout settles: features that load after a jump change the heights above
   * it, and CodeMirror's own anchoring does not always undo that. The hold
   * ends when the reader scrolls or types, or a jump elsewhere replaces it.
   */
  holdAtTop?(position: number, yMargin: number): ScrollHold;
  onNavigate(capture: () => () => void): Disposer;
  batch?<T>(fn: () => T): T;
  flush?(): void;
  dispatchEffect?(effect: StateEffect<unknown>): boolean;
  settled(): Promise<boolean>;
  focus(): void;
}
export interface EditorPanel extends PanelPort {
  readonly session: DocumentSession;
  readonly ready?: Promise<void>;
  readonly webviewGeneration?: number;
  webviewPluginStates?(): readonly RuntimePluginState[];
  pluginStates?(): readonly RuntimePluginState[];
  refreshPlugins?(): Promise<void>;
}
export interface ViewSnapshot {
  readonly editorId: string;
  readonly documentUri: string;
  readonly documentVersion: number;
  readonly state: Infer<typeof viewState>;
}
export interface Editors {
  capture(editorId: string): Promise<ViewSnapshot>;
  restore(editorId: string, snapshot: ViewSnapshot): Promise<void>;
  all(): readonly EditorPanel[];
  active(): EditorPanel | undefined;
}
declare module "@workshop/core" {
  interface Services {
    editor: EditorService;
    menu: Menu;
    editors: Editors;
  }
  interface Events {
    /** Widget-handled user scroll input, including ticks chained at an edge. @mode emit */
    "editor/scrollInput": (view: EditorView) => void;
    /** @mode pipeline */ "editor/selectionMenu": (
      items: readonly MenuItem[],
    ) => readonly MenuItem[] | Promise<readonly MenuItem[]>;
    /** @mode emit */ "editor/clearProjection": () => void;
    /** @mode bail */ "editor/batchExtensions": <T>(fn: () => T) => T;
    /** @mode bail */ "editor/activeView": () => EditorView | undefined;
    /** @mode bail */ "editor/projectSelection": () =>
      { from: number; to: number } | undefined;
    /** @mode emit */ "editor/modeRestored": (
      mode: "source" | "livePreview",
    ) => void;
    /** @mode emit */ "editor/configure": () => void;
    /** @mode emit */ "editor/pluginsChanged": (panel: PanelPort) => void;
    /** @mode emit */ "editor/loading": () => void;
    /** Ready payload built; deferred panel hosts may start. @mode emit */
    "editor/session-ready": () => void;
    /** @mode emit */ "editor/ready": (panel: PanelPort) => void;
    /** @mode emit */ "editor/opened": (panel: PanelPort) => void;
    /** @mode emit */ "editor/closed": (panel: PanelPort) => void;
    /** @mode emit */ "editor/activeChanged": (
      panel: PanelPort | undefined,
    ) => void;
    /** @mode emit */ "editor/selectionChanged": (
      panel: PanelPort,
      hasSelection: boolean,
    ) => void;
  }
}

export interface SourceSelection {
  readonly id: string;
  readonly editorId: string;
  readonly documentId: string;
  readonly version: number;
  readonly isDirty: boolean;
  readonly sourceSha256?: string;
  readonly from: number;
  readonly to: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
}
export interface Selections {
  capture(
    editorId: string,
    token?: Cancellation,
  ): Promise<SourceSelection | undefined>;
  validate(selection: SourceSelection): EditorPanel;
}
declare module "@workshop/core" {
  interface Services {
    selections: Selections;
  }
}
