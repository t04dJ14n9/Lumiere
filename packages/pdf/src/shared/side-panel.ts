/**
 * The viewer's side panel (#867): a panel inside the viewer, hidden until the
 * reader turns it on, that travels with the PDF, so a PDF moved into a
 * floating window (which has no side bar) still has its outline and the rest
 * within reach. What is remembered of it is small: whether it is open, how wide
 * it is, and which tab it shows.
 *
 * The extension keeps one such state per PDF editor and the last one chosen in
 * any editor, which a new editor starts from (`PdfViewerPanel.sidePanel`).
 */

export const SIDE_PANEL_TABS = [
  "thumbnails",
  "outline",
  "bookmarks",
  "annotations",
] as const;

export type SidePanelTab = (typeof SIDE_PANEL_TABS)[number];

export interface SidePanelState {
  open: boolean;
  /** In CSS pixels, between the panel's limits. */
  width: number;
  tab: SidePanelTab;
}

/** VS Code's own side bar cannot be dragged narrower than 170 px. */
export const MIN_SIDE_PANEL_WIDTH = 160;
export const MAX_SIDE_PANEL_WIDTH = 640;
export const DEFAULT_SIDE_PANEL_WIDTH = 240;

/** The panel never takes more than this share of the viewer, whatever its width setting. */
export const MAX_SIDE_PANEL_SHARE = 0.6;

/** Closed, and on the Outline, the tab a floating window misses most. */
export const DEFAULT_SIDE_PANEL: SidePanelState = {
  open: false,
  width: DEFAULT_SIDE_PANEL_WIDTH,
  tab: "outline",
};

export function isSidePanelTab(value: unknown): value is SidePanelTab {
  return (
    typeof value === "string" &&
    (SIDE_PANEL_TABS as readonly string[]).includes(value)
  );
}

/**
 * A width within the panel's limits, and, when the viewer's width is known,
 * within its share of it (a narrow editor keeps room for the pages). The
 * minimum wins where the two disagree: a panel narrower than that is
 * unusable.
 */
export function clampSidePanelWidth(
  width: number,
  viewerWidth?: number,
): number {
  const share =
    viewerWidth === undefined
      ? MAX_SIDE_PANEL_WIDTH
      : Math.floor(viewerWidth * MAX_SIDE_PANEL_SHARE);
  const most = Math.max(
    MIN_SIDE_PANEL_WIDTH,
    Math.min(MAX_SIDE_PANEL_WIDTH, share),
  );
  return Math.round(Math.min(Math.max(width, MIN_SIDE_PANEL_WIDTH), most));
}

/**
 * A state from the viewer, the extension's memory or a message. `open` must
 * be a boolean; a width that is no number, and a tab nobody knows, fall back
 * to the defaults rather than refusing the rest.
 */
export function parseSidePanelState(
  value: unknown,
): SidePanelState | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const { open, width, tab } = value as Record<string, unknown>;
  if (typeof open !== "boolean") {
    return undefined;
  }
  return {
    open,
    width:
      typeof width === "number" && Number.isFinite(width)
        ? clampSidePanelWidth(width)
        : DEFAULT_SIDE_PANEL_WIDTH,
    tab: isSidePanelTab(tab) ? tab : DEFAULT_SIDE_PANEL.tab,
  };
}

export function sameSidePanelState(
  a: SidePanelState,
  b: SidePanelState,
): boolean {
  return a.open === b.open && a.width === b.width && a.tab === b.tab;
}
