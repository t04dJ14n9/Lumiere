import React from "react";
import type { OutlineItem } from "../../shared/messages";
import type { PdfLocation } from "../../shared/pdf-location";
import {
  clampSidePanelWidth,
  type SidePanelTab,
} from "../../shared/side-panel";
import { AnnotationsTab } from "./annotations-tab";
import { BookmarksTab } from "./bookmarks-tab";
import { OutlineTab } from "./outline-tab";
import { Sash } from "./sash";
import { chooseSidePanel, useSidePanelState } from "./state";
import { TabStrip, tabId, tabPanelId } from "./tab-strip";
import { ThumbnailsTab } from "./thumbnails-tab";
import { useViewerWidth } from "./viewer-width";
import { t } from "@workshop/l10n";

/** Go to a place in the PDF as a deliberate jump, which Back returns from. */
export type SidePanelJump = (
  location: PdfLocation,
  top?: number,
  left?: number,
) => void;

export interface SidePanelProps {
  jumpTo: SidePanelJump;
  /** The page being read. */
  currentPage: number;
  /** `undefined` while the PDF's outline is being read. */
  outline: readonly OutlineItem[] | undefined;
}

/**
 * The panel inside the viewer, on its left edge (#867): Thumbnails, Outline,
 * Bookmarks and Annotations of the PDF, each of which takes the viewer to a
 * place. It belongs to the viewer, so it goes with the PDF into a floating
 * window, which has no side bar of its own. Hidden until the reader turns it
 * on (Toggle Side Panel, or the editor title button); it never takes the
 * keyboard unless the reader clicks into it.
 */
export function SidePanel(props: SidePanelProps): React.JSX.Element | null {
  const state = useSidePanelState();
  const viewerWidth = useViewerWidth();
  if (!state.open) {
    return null;
  }
  // Drawn within the share of this viewer that a panel may take. The width
  // the reader chose stays as it was saved: it comes back in a wider editor,
  // and only a drag changes it.
  const width = clampSidePanelWidth(state.width, viewerWidth);
  return (
    <aside
      className="side-panel"
      style={{ width }}
      aria-label={t("Side panel")}
    >
      <TabStrip
        tab={state.tab}
        onSelect={(tab) => chooseSidePanel({ tab })}
        onClose={() => chooseSidePanel({ open: false })}
      />
      <div
        className="sp-body"
        role="tabpanel"
        id={tabPanelId(state.tab)}
        aria-labelledby={tabId(state.tab)}
      >
        <TabBody tab={state.tab} width={width} {...props} />
      </div>
      <Sash
        width={width}
        onResize={(next) =>
          chooseSidePanel({ width: clampWidth(next) }, { commit: false })
        }
        onCommit={(next) => chooseSidePanel({ width: clampWidth(next) })}
      />
    </aside>
  );
}

/** Within the panel's limits and the room the viewer has to give. */
function clampWidth(width: number): number {
  return clampSidePanelWidth(width, window.innerWidth);
}

function TabBody({
  tab,
  width,
  jumpTo,
  currentPage,
  outline,
}: SidePanelProps & { tab: SidePanelTab; width: number }): React.JSX.Element {
  switch (tab) {
    case "thumbnails":
      return (
        <ThumbnailsTab
          currentPage={currentPage}
          panelWidth={width}
          jumpTo={jumpTo}
        />
      );
    case "outline":
      return <OutlineTab items={outline} jumpTo={jumpTo} />;
    case "bookmarks":
      return <BookmarksTab jumpTo={jumpTo} />;
    case "annotations":
      return <AnnotationsTab jumpTo={jumpTo} />;
  }
}
