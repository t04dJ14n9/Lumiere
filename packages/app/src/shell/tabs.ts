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
  | { readonly type: "last" }
  /** A file or folder of the vault moved: its tabs follow it. */
  | {
      readonly type: "moved";
      readonly vault: string;
      readonly from: string;
      readonly to: string;
    }
  /** A file or folder of the vault was deleted: its tabs close. */
  | { readonly type: "removed"; readonly vault: string; readonly path: string };

export const SETTINGS_TAB = "settings";

/**
 * Note tabs whose page stays loaded. Each page is a whole editor, so a
 * window with many tabs keeps only those used last; the others' pages go,
 * which writes their notes at once (the page shim's `pagehide`), and load
 * again when shown, reading back their scroll position (its `getState`).
 */
export const MAX_LIVE_EDITORS = 5;

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

/** The note tabs whose pages stay loaded: the shown one and those shown last. */
export function liveNoteTabs(
  state: TabsState,
  limit = MAX_LIVE_EDITORS,
): ReadonlySet<string> {
  const notes = new Set(
    state.tabs.filter((tab) => tab.kind === "note").map((tab) => tab.id),
  );
  const live = new Set<string>();
  for (const id of [state.active, ...state.recent]) {
    if (live.size >= limit) {
      break;
    }
    if (id !== undefined && notes.has(id)) {
      live.add(id);
    }
  }
  return live;
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
    case "moved":
      return moved(state, action);
    case "removed":
      return state.tabs
        .filter((tab) => isIn(tab, action.vault, action.path))
        .reduce((left, tab) => close(left, tab.id), state);
  }
}

/** Whether a note tab shows `path` of `vault` or a file in that folder. */
function isIn(tab: Tab, vault: string, path: string): tab is NoteTab {
  return (
    tab.kind === "note" &&
    tab.vault === vault &&
    (tab.path === path || tab.path.startsWith(`${path}/`))
  );
}

/** The tabs of what moved show it at its new path, keeping their places. */
function moved(
  state: TabsState,
  { vault, from, to }: { vault: string; from: string; to: string },
): TabsState {
  const ids = new Map<string, string>();
  const tabs = state.tabs.map((tab): Tab => {
    if (!isIn(tab, vault, from)) {
      return tab;
    }
    const path = to + tab.path.slice(from.length);
    const id = tabId(vault, path);
    ids.set(tab.id, id);
    return { ...tab, id, path };
  });
  const rename = (id: string) => ids.get(id) ?? id;
  return {
    tabs,
    active: state.active === undefined ? undefined : rename(state.active),
    recent: state.recent.map(rename),
  };
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
