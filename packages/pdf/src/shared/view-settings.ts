import { MAX_ZOOM, MIN_ZOOM } from "./zoom-steps";

export type ZoomChoice = "fitWidth" | "fitPage" | "actual" | number;
export type PageLayout = "single" | "spread" | "spreadCover";
export type ScrollMode = "continuous" | "paged";
export type ScrollDirection = "vertical" | "horizontal";

export interface ViewChoices {
  pageLayout: PageLayout;
  scrollMode: ScrollMode;
  scrollDirection: ScrollDirection;
}

export interface ViewSettings extends ViewChoices {
  /** Numeric values are percentages. */
  defaultZoom: ZoomChoice;
  /** null follows editor.smoothScrolling; the host resolves it before sending. */
  smoothScrolling: boolean | null;
  /** Empty-page / Select Region; owned by pdfRegions (`lumiere.pdf.regions.enabled`). */
  regionsEnabled: boolean;
  /** Plain Left/Right turn the page keeping the place; ⌥ gives them their usual meaning. */
  arrowsKeepPlace: boolean;
  /**
   * The viewer's default shortcuts (`lumiere.pdf.keyboardShortcuts`); off
   * leaves every key to VS Code. Optional so hosts without the setting
   * need not name it: missing is on.
   */
  keyboardShortcuts?: boolean;
  /**
   * A wheel or trackpad gesture that is nearly straight scrolls along that
   * one axis (`editor.scrollPredominantAxis`, which the host reads for the
   * PDF). Optional so hosts without the setting need not name it: missing is on.
   */
  predominantAxis?: boolean;
  /**
   * The side panel's outline keeps the reading position's bookmark selected,
   * as the Explorer's does (`lumiere.pdf.outline.followCursor`). Optional so
   * hosts without the setting need not name it: missing is on.
   */
  outlineFollowCursor?: boolean;
}

/**
 * Whether a key opens Find in the viewer: ⌘F on a Mac, Ctrl+F elsewhere,
 * with no other modifier (⇧⌘F and ⌥⌘F are VS Code's), and only while the
 * viewer's shortcuts are on, as the same key's VS Code binding.
 */
export function isFindKey(
  event: {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  },
  options: { mac: boolean; shortcuts: boolean },
): boolean {
  const command = options.mac ? event.metaKey : event.ctrlKey;
  const other = options.mac ? event.ctrlKey : event.metaKey;
  return (
    options.shortcuts &&
    command &&
    !other &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "f"
  );
}

export const DEFAULT_VIEW_CHOICES: ViewChoices = {
  pageLayout: "single",
  scrollMode: "continuous",
  scrollDirection: "vertical",
};

export function isPageLayout(value: unknown): value is PageLayout {
  return value === "single" || value === "spread" || value === "spreadCover";
}

export function isScrollMode(value: unknown): value is ScrollMode {
  return value === "continuous" || value === "paged";
}

export function isScrollDirection(value: unknown): value is ScrollDirection {
  return value === "vertical" || value === "horizontal";
}

export function isZoomChoice(value: unknown): value is ZoomChoice {
  return (
    value === "fitWidth" ||
    value === "fitPage" ||
    value === "actual" ||
    (typeof value === "number" && Number.isFinite(value) && value > 0)
  );
}

export function parseDefaultZoom(value: unknown): ZoomChoice {
  if (!isZoomChoice(value)) {
    return "fitWidth";
  }
  return typeof value === "number"
    ? Math.min(MAX_ZOOM * 100, Math.max(MIN_ZOOM * 100, value))
    : value;
}

export function parseViewSettings(value: unknown): ViewSettings {
  const settings =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    defaultZoom: parseDefaultZoom(settings.defaultZoom),
    pageLayout: isPageLayout(settings.pageLayout)
      ? settings.pageLayout
      : "single",
    scrollMode: isScrollMode(settings.scrollMode)
      ? settings.scrollMode
      : "continuous",
    scrollDirection: isScrollDirection(settings.scrollDirection)
      ? settings.scrollDirection
      : "vertical",
    smoothScrolling:
      typeof settings.smoothScrolling === "boolean"
        ? settings.smoothScrolling
        : null,
    regionsEnabled: settings.regionsEnabled === true,
    arrowsKeepPlace: settings.arrowsKeepPlace !== false,
    keyboardShortcuts: settings.keyboardShortcuts !== false,
    predominantAxis: settings.predominantAxis !== false,
    outlineFollowCursor: settings.outlineFollowCursor !== false,
  };
}

/** Reduced motion wins over explicit and inherited preferences. */
export function resolveSmoothScrolling(
  setting: unknown,
  editor: unknown,
  reducedMotion: boolean,
): boolean {
  return (
    !reducedMotion && (typeof setting === "boolean" ? setting : editor === true)
  );
}
