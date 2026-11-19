/**
 * The window's tabs: which notes are open, in order, which one shows, and
 * the order they were used in (for ⌃⇥, which goes back to the last one).
 * Settings opens as a tab too, as in VS Code.
 */
import { fileKind } from "../shared/file-kind";
import type { SavedTab, UiState } from "../shared/ui-state";

export interface NoteTab {
  readonly kind: "note";
  readonly id: string;
  /** The vault folder (absolute). */
  readonly vault: string;
  /** The file, relative to the vault, with `/`. */
  readonly path: string;
}

export interface SettingsTab {
  readonly kind: "settings";
  readonly id: typeof SETTINGS_TAB;
}

export type Tab = NoteTab | SettingsTab;

/** Whether a sketch can go into this tab: a Markdown note, not a PDF or Settings. */
export function takesSketch(tab: Tab | undefined): boolean {
  return tab?.kind === "note" && fileKind(tab.path) === "note";
}

export interface TabsState {
  readonly tabs: readonly Tab[];
  readonly active: string | undefined;
  /** Tab ids, the most recently shown first. */
  readonly recent: readonly string[];
}

export type TabsAction =
  | { readonly type: "open"; readonly vault: string; readonly path: string }
  | { readonly type: "openSettings" }
  | { readonly type: "close"; readonly id: string }
  | { readonly type: "activate"; readonly id: string }
  /** The tab beside the shown one: 1 to the right, -1 to the left, wrapping. */
  | { readonly type: "step"; readonly by: 1 | -1 }
  /** The tab shown before this one. */
  | { readonly type: "last" };

export const SETTINGS_TAB = "settings";

export const noTabs: TabsState = { tabs: [], active: undefined, recent: [] };

export function tabId(vault: string, path: string): string {
  return `${vault}\u0000${path}`;
}

/**
 * The tab ⌘W closes: the shown one while there are others. With one tab or
 * none it closes nothing, and ⌘W closes the window instead.
 */
export function tabToClose(state: TabsState): string | undefined {
  return state.tabs.length > 1 ? state.active : undefined;
}

/** What a tab is called in the tab strip. */
export function tabTitle(tab: Tab): string {
  return tab.kind === "settings"
    ? "Settings"
    : tab.path
        .slice(tab.path.lastIndexOf("/") + 1)
        .replace(/\.(md|markdown)$/i, "");
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "open":
      return show(state, {
        kind: "note",
        id: tabId(action.vault, action.path),
        vault: action.vault,
        path: action.path,
      });
    case "openSettings":
      return show(state, { kind: "settings", id: SETTINGS_TAB });
    case "activate":
      return activate(state, action.id);
    case "step":
      return activate(state, beside(state, action.by));
    case "last":
      return activate(state, state.recent[1]);
    case "close":
      return close(state, action.id);
  }
}

/** Show a tab, opening it after the others when it is not open yet. */
function show(state: TabsState, tab: Tab): TabsState {
  const tabs = state.tabs.some((item) => item.id === tab.id)
    ? state.tabs
    : [...state.tabs, tab];
  return activate({ ...state, tabs }, tab.id);
}

function activate(state: TabsState, id: string | undefined): TabsState {
  if (id === undefined || !state.tabs.some((tab) => tab.id === id)) {
    return state;
  }
  return {
    ...state,
    active: id,
    recent: [id, ...state.recent.filter((item) => item !== id)],
  };
}

function beside(state: TabsState, by: 1 | -1): string | undefined {
  const index = state.tabs.findIndex((tab) => tab.id === state.active);
  if (index < 0) {
    return undefined;
  }
  const count = state.tabs.length;
  return state.tabs[(index + by + count) % count]?.id;
}

/** Closing the shown tab shows its right neighbour, else its left one. */
function close(state: TabsState, id: string): TabsState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) {
    return state;
  }
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  const recent = state.recent.filter((item) => item !== id);
  if (state.active !== id) {
    return { tabs, active: state.active, recent };
  }
  const next = tabs[Math.min(index, tabs.length - 1)]?.id;
  return next === undefined
    ? noTabs
    : activate({ tabs, active: undefined, recent }, next);
}

/** The note tabs to keep for the next launch (Settings is not kept). */
export function tabsToSave(
  state: TabsState,
): Pick<UiState, "tabs" | "activeTab"> {
  const notes = state.tabs.filter((tab): tab is NoteTab => tab.kind === "note");
  return {
    tabs: notes.map(({ vault, path }) => ({ vault, path })),
    activeTab: notes.findIndex((tab) => tab.id === state.active),
  };
}

/** Reopen the saved tabs of the vaults that are open, showing the one shown last. */
export function restoreTabs(
  saved: Pick<UiState, "tabs" | "activeTab">,
  openVaults: readonly string[],
): TabsAction[] {
  const kept = (tab: SavedTab | undefined): tab is SavedTab =>
    tab !== undefined && openVaults.includes(tab.vault);
  const opens: TabsAction[] = saved.tabs
    .filter(kept)
    .map((tab) => ({ type: "open", vault: tab.vault, path: tab.path }));
  const shown = saved.tabs[saved.activeTab];
  return kept(shown)
    ? [...opens, { type: "activate", id: tabId(shown.vault, shown.path) }]
    : opens;
}
