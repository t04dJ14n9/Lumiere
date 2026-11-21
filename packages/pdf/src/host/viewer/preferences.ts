import type { PdfConfiguration, PdfState } from "../../shared/host";
import {
  parseSavedPosition,
  savedPosition,
  type ReadingPosition,
} from "../../shared/reading-position";
import {
  parseViewSettings,
  resolveSmoothScrolling,
  type ViewSettings,
} from "../../shared/view-settings";
import type { PdfViewerPanel } from "./panel";

const SECTION = "lumiere.pdf.view";
const EDITOR_SMOOTH_SCROLLING = "editor.smoothScrolling";
const EDITOR_PREDOMINANT_AXIS = "editor.scrollPredominantAxis";
const REGIONS_SETTING = "lumiere.pdf.regions.enabled";
const SHORTCUTS_SETTING = "lumiere.pdf.keyboardShortcuts";

/** Defaults for new views; saved positions are read once, independently by each panel. */
export class PdfViewPreferences {
  private readonly stop: () => void;

  constructor(
    private readonly configuration: PdfConfiguration,
    private readonly state: PdfState,
    panels: { readonly all: readonly PdfViewerPanel[] },
  ) {
    this.stop = configuration.onChange((affects) => {
      if (
        !affects(SECTION) &&
        !affects(EDITOR_SMOOTH_SCROLLING) &&
        !affects(EDITOR_PREDOMINANT_AXIS) &&
        !affects(REGIONS_SETTING) &&
        !affects(SHORTCUTS_SETTING)
      ) {
        return;
      }
      for (const panel of panels.all) {
        panel.setViewSettings(this.settings(panel.fileUri));
      }
    });
  }

  /** The view settings for the PDF at `uri`. */
  settings(uri: string): ViewSettings {
    const view = (key: string) =>
      this.configuration.get(`${SECTION}.${key}`, uri);
    const settings = parseViewSettings({
      defaultZoom: view("defaultZoom"),
      pageLayout: view("pageLayout"),
      scrollMode: view("scrollMode"),
      scrollDirection: view("scrollDirection"),
      smoothScrolling: view("smoothScrolling"),
      arrowsKeepPlace: view("arrowsKeepPlace"),
      regionsEnabled: this.configuration.get(REGIONS_SETTING, uri) === true,
      keyboardShortcuts: this.configuration.get(SHORTCUTS_SETTING, uri),
      predominantAxis: this.configuration.get(EDITOR_PREDOMINANT_AXIS, uri),
    });
    settings.smoothScrolling = resolveSmoothScrolling(
      settings.smoothScrolling,
      this.configuration.get(EDITOR_SMOOTH_SCROLLING, uri),
      false,
    );
    return settings;
  }

  /** Where the PDF at `uri` was left, unless the reader turned that off. */
  position(uri: string): ReadingPosition | undefined {
    const restore =
      this.configuration.get(`${SECTION}.restoreOnReopen`, uri) ?? true;
    if (!restore) {
      return undefined;
    }
    return parseSavedPosition(
      this.positions()[uri] ?? this.state.get(legacyPositionKey(uri)),
    );
  }

  /**
   * Keep where the PDF at `uri` is. All PDFs share one state entry, the
   * most recently read last, and only the last `MAX_POSITIONS` are kept;
   * a PDF's entry of its own from an earlier version goes once it is saved.
   */
  save(uri: string, position: ReadingPosition): void {
    const positions = this.positions();
    delete positions[uri];
    positions[uri] = savedPosition(position);
    const uris = Object.keys(positions);
    for (const old of uris.slice(0, Math.max(0, uris.length - MAX_POSITIONS))) {
      delete positions[old];
    }
    // Detached storage work has an error sink; open panels never follow this saved value.
    const failed = (error: unknown) =>
      console.error("Could not save PDF view", error);
    void this.state.update(POSITIONS_KEY, positions).catch(failed);
    if (this.state.get(legacyPositionKey(uri)) !== undefined) {
      void this.state.update(legacyPositionKey(uri), undefined).catch(failed);
    }
  }

  /** The saved positions by PDF, oldest first; a copy to change. */
  private positions(): Record<string, unknown> {
    const saved = this.state.get(POSITIONS_KEY);
    return typeof saved === "object" && saved !== null && !Array.isArray(saved)
      ? { ...(saved as Record<string, unknown>) }
      : {};
  }

  dispose(): void {
    this.stop();
  }
}

/** Where each PDF was left, by URI: one state entry for all of them. */
const POSITIONS_KEY = "lumiere.pdf.readingPositions";
/** PDFs whose place is kept; reading one more forgets the one read longest ago. */
export const MAX_POSITIONS = 500;

/** Where earlier versions kept a PDF's place: a state entry of its own, never removed. */
function legacyPositionKey(uri: string): string {
  return `lumiere.pdf.readingPosition:${uri}`;
}
