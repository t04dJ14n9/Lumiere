/**
 * Where the viewer's controls are (setting `lumiere.pdf.toolbar.mode`):
 *   chrome  VS Code status bar (and Settings / command palette)
 *   none    no status-bar PDF entries; keyboard, menus and commands only
 *   slim    in-page slim bar — used by stand-alone hosts (web / iPad) that
 *           have no VS Code status bar; not offered in the VS Code setting
 *
 * Floating was removed. Saved VS Code values of slim/floating migrate to chrome.
 */
export type ToolbarMode = "chrome" | "slim" | "none";
const DEFAULT_TOOLBAR_MODE: ToolbarMode = "chrome";

/**
 * Legacy dock edge for the removed floating bar. Kept so old messages and
 * HTML data attributes still parse; new code always uses the default.
 */
export type FloatingDock = "top" | "bottom" | "left" | "right";
const FLOATING_DOCKS: readonly FloatingDock[] = [
  "top",
  "bottom",
  "left",
  "right",
];
export const DEFAULT_FLOATING_DOCK: FloatingDock = "bottom";

/** The toolbar settings the viewer needs. */
export interface ToolbarSettings {
  mode: ToolbarMode;
  /** Unused after floating removal; kept for message / HTML compatibility. */
  dock: FloatingDock;
}

export const DEFAULT_TOOLBAR_SETTINGS: ToolbarSettings = {
  mode: DEFAULT_TOOLBAR_MODE,
  dock: DEFAULT_FLOATING_DOCK,
};

/**
 * A setting's value as a mode. Floating migrates to chrome. Slim is kept for
 * stand-alone hosts (`PAGE_TOOLBAR`); the VS Code setting enum is chrome|none.
 */
export function parseToolbarMode(value: unknown): ToolbarMode {
  if (value === "none" || value === "slim" || value === "chrome") {
    return value;
  }
  if (value === "floating") {
    return "chrome";
  }
  return DEFAULT_TOOLBAR_MODE;
}

/**
 * VS Code setting values only: slim/floating (and unknown) → chrome.
 * Stand-alone hosts should set `PAGE_TOOLBAR` directly, not this.
 */
export function parseVsCodeToolbarMode(value: unknown): "chrome" | "none" {
  return value === "none" ? "none" : "chrome";
}

export function isFloatingDock(value: unknown): value is FloatingDock {
  return FLOATING_DOCKS.includes(value as FloatingDock);
}

/** A stored dock; anything unknown is the default. */
export function parseFloatingDock(value: unknown): FloatingDock {
  return isFloatingDock(value) ? value : DEFAULT_FLOATING_DOCK;
}

/** Toolbar settings from a message, with defaults for anything malformed. */
export function parseToolbarSettings(value: unknown): ToolbarSettings {
  const settings =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    mode: parseToolbarMode(settings.mode),
    dock: parseFloatingDock(settings.dock),
  };
}

/**
 * Whether the status bar shows history, page, zoom and find buttons besides
 * the page and zoom (setting `lumiere.pdf.toolbar.statusBarButtons`). The
 * editor title bar keeps every PDF action in its "…" menu, in VS Code as in
 * Cursor, so the status bar is the only place the buttons are in view:
 * `auto` shows them.
 */
export function showStatusBarButtons(setting: unknown): boolean {
  return setting !== "never";
}
