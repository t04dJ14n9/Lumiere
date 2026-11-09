import { Scrollbar, Stage } from "@embedpdf/react/stage";
import React, { useEffect, useRef, useState } from "react";
import { useEndDragsReleasedOutside } from "./drag-release";
import { useNavigation } from "./navigation";
import { useOutlinePublishing } from "./outline";
import { Page } from "./page";
import { currentViewSettings, useRestorePosition } from "./reading-position";
import type { ViewChoices } from "../shared/view-settings";
import { usePagingKeys } from "./paging-input";
import { useSmoothMotion, useSmoothWheel } from "./smooth-scrolling";
import { zenToolbarMode } from "../shared/zen";
import { useZen } from "./zen";
import { useViewLayout } from "./view-layout";
import { useExposeStageForTests } from "./test-hook";
import { SearchBar } from "./search-bar";
import { useIgnoreSecondaryButtons } from "./secondary-buttons";
import { useLookUp } from "./look-up";
import { isEditableTarget } from "./editable-target";
import { useSelectionReporting } from "./selection";
import { useAnnotationMode } from "./annotation-mode";
import { useAnnotationSaveSession } from "./annotation-session";
import { useMarkSelection } from "./mark-selection";
import { shouldDeleteAnnotationOnKey } from "../shared/annotation-delete-keys";
import { useToolMode } from "./tool-mode";
import { currentToolbarSettings } from "./toolbar-settings";
import { rememberPageColors } from "./page-colors";
import { useRepaintOnPageColors } from "./page-colors-render";
import { Toolbar } from "./toolbar";
import { useViewActions, useViewReporting } from "./view-sync";
import { useHostMessages } from "./host-messages";
import { useJumpHistory } from "./jump-history";
import {
  rememberedChoices,
  useRegionsEnabled,
  withHistory,
} from "./viewer-helpers";

/**
 * The open PDF: an optional search bar and the scrolling pages. Controls
 * live on the VS Code status bar (or commands when toolbar.mode is none).
 * Mounted once the document is ready, inside EmbedPDF (engine.tsx).
 */
export function Viewer(): React.JSX.Element {
  useExposeStageForTests();
  const view = useViewerState();
  const {
    choices,
    smooth,
    toolbar,
    tool,
    navigation,
    history,
    search,
    regionsEnabled,
  } = view;
  return (
    <div
      className={`viewer tool-${tool} toolbar-${toolbar.mode}${smooth ? " smooth-motion" : ""}`}
      data-smooth-scrolling={smooth}
      data-scroll-mode={choices.scrollMode}
      data-page-layout={choices.pageLayout}
      data-scroll-direction={choices.scrollDirection}
    >
      {toolbar.mode === "slim" && (
        <Toolbar
          navigation={navigation}
          tool={tool}
          regionsEnabled={regionsEnabled}
          choices={choices}
          run={view.runAction}
          history={history}
        />
      )}
      <div className="document" ref={view.documentArea}>
        {search.isOpen && (
          <SearchBar
            navigation={navigation}
            focusRequest={search.focusRequest}
            onPreviewEnd={history.endPreview}
            onClose={search.close}
          />
        )}
        <DocumentPages
          choices={choices}
          navigation={navigation}
          selection={view.selection}
          annotate={tool === "annotate"}
        />
      </div>
    </div>
  );
}

/** Everything the viewer tracks and listens to, for one open PDF. */
function useViewerState() {
  const [choices, setChoices] = useState<ViewChoices>(rememberedChoices);
  const [motionSetting, setMotionSetting] = useState(
    () => currentViewSettings().smoothScrolling,
  );
  const [regionsEnabled, setRegionsEnabled] = useRegionsEnabled();
  const smooth = useSmoothMotion(motionSetting);
  const rawNavigation = useNavigation(choices.scrollMode, smooth);
  const history = useJumpHistory(rawNavigation, choices, setChoices);
  const navigation = withHistory(rawNavigation, history);
  const search = useSearch();
  useOutlinePublishing();
  useRepaintOnPageColors();
  const documentArea = useRef<HTMLDivElement>(null);
  useDocumentInput(documentArea, { choices, navigation, smooth });
  const [lookUp, setLookUp] = useState(false);
  const requestLookUp = useLookUp(lookUp);
  const [setting, setToolbar] = useState(currentToolbarSettings);
  const [zen, setZen] = useZen();
  const tools = useViewerTools({
    navigation,
    search,
    choices,
    setChoices,
    regionsEnabled,
  });
  useHostMessages({
    show: navigation.show,
    history,
    runAction: tools.runAction,
    requestLookUp,
    reportSelection: tools.selection.reportNow,
    setLookUp,
    setZen,
    setToolbar,
    setMotionSetting,
    setRegionsEnabled,
    setChoices,
    setPageColors: rememberPageColors,
    retryAnnotationSave: tools.annotationSave.retry,
    writeAnnotations: tools.annotationSave.write,
  });
  return {
    choices,
    smooth,
    navigation,
    history,
    selection: tools.selection,
    search,
    documentArea,
    tool: tools.tool,
    annotation: tools.annotation,
    annotationSelection: tools.annotationSelection,
    runAction: tools.runAction,
    regionsEnabled,
    zen,
    toolbar: { ...setting, mode: zenToolbarMode(setting.mode, zen) },
  };
}

type ViewerToolsDeps = {
  navigation: ReturnType<typeof withHistory>;
  search: ReturnType<typeof useSearch>;
  choices: ViewChoices;
  setChoices: React.Dispatch<React.SetStateAction<ViewChoices>>;
  regionsEnabled: boolean;
};

/** Tool mode, annotations, selection reporting, view actions and keys. */
function useViewerTools(deps: ViewerToolsDeps) {
  const { navigation, search, choices, setChoices, regionsEnabled } = deps;
  const { tool, setTool } = useToolMode(regionsEnabled);
  const annotation = useAnnotationMode();
  const annotationSave = useAnnotationSaveSession();
  const annotationSelected = useRef(false);
  const selection = useSelectionReporting(() =>
    Boolean(annotationSelected.current),
  );
  const annotationSelection = useMarkSelection(
    tool === "annotate",
    selection.setAnnotationRegion,
  );
  annotationSelected.current = annotationSelection.hasAnnotationSelection;
  useViewReporting(navigation, tool, choices, annotation);
  const runAction = useViewActions(navigation, search.open, setTool, {
    setChoices: (next) => setChoices((current) => ({ ...current, ...next })),
    setAnnotationTool: annotation.setAnnotationTool,
    setColor: annotation.setColor,
    undo: annotation.undo,
    redo: annotation.redo,
    deleteSelectedAnnotations: annotationSelection.deleteSelected,
  });
  useViewerKeys({
    selection,
    search,
    tool,
    setTool,
    hasAnnotationSelection: annotationSelection.hasAnnotationSelection,
    editingAnnotationText: annotationSelection.editingText,
    deleteSelectedAnnotations: annotationSelection.deleteSelected,
  });
  return {
    tool,
    annotation,
    annotationSave,
    annotationSelection,
    selection,
    runAction,
  };
}

type Selection = ReturnType<typeof useSelectionReporting>;

/** The search bar: open, and how many times Find was asked for. */
function useSearch() {
  const [isOpen, setOpen] = useState(false);
  /** Counts Find requests, so Find on an open search bar focuses it again. */
  const [focusRequest, setFocusRequest] = useState(0);
  return {
    isOpen,
    focusRequest,
    open: (): void => {
      setOpen(true);
      setFocusRequest((request) => request + 1);
    },
    close: (): void => setOpen(false),
  };
}

/** Wheel, keys and gestures over the pages, for the current layout. */
function useDocumentInput(
  documentArea: React.RefObject<HTMLDivElement | null>,
  view: {
    choices: ViewChoices;
    navigation: ReturnType<typeof withHistory>;
    smooth: boolean;
  },
): void {
  const { choices, navigation, smooth } = view;
  useSmoothWheel(
    documentArea,
    smooth,
    choices.scrollDirection,
    choices.scrollMode,
  );
  usePagingKeys({
    mode: choices.scrollMode,
    direction: choices.scrollDirection,
    step: navigation.step,
  });
  useViewLayout(choices, smooth);
  useEndDragsReleasedOutside();
  useIgnoreSecondaryButtons(documentArea);
}

/** Cmd/Ctrl+F opens the search bar; Escape closes it, or drops the tool or selection. */
function useViewerKeys(state: {
  selection: Selection;
  search: ReturnType<typeof useSearch>;
  tool: string;
  setTool: (tool: "text" | "region" | "annotate") => void;
  hasAnnotationSelection: boolean;
  /** Someone is typing in a free-text box: Delete and Backspace edit its text. */
  editingAnnotationText: boolean;
  deleteSelectedAnnotations: () => void;
}): void {
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        latest.current.search.open();
      } else if (event.key === "Escape") {
        onEscape(latest.current);
      } else if (
        shouldDeleteAnnotationOnKey({
          key: event.key,
          annotate: latest.current.tool === "annotate",
          hasAnnotationSelection: latest.current.hasAnnotationSelection,
          editingText: latest.current.editingAnnotationText,
          editable: isEditableTarget(event.target),
        })
      ) {
        event.preventDefault();
        latest.current.deleteSelectedAnnotations();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}

function onEscape(state: {
  selection: Selection;
  search: ReturnType<typeof useSearch>;
  tool: string;
  setTool: (tool: "text" | "region" | "annotate") => void;
}): void {
  const { search, selection, tool, setTool } = state;
  if (document.querySelector(".view-menu:popover-open")) {
    return;
  }
  if (search.isOpen) {
    search.close();
  } else if (tool === "annotate") {
    // Spec: Escape exits Annotate mode.
    setTool("text");
  } else if (tool === "region" && !selection.region) {
    // With nothing selected, Escape puts down the Select Region tool.
    setTool("text");
  } else {
    selection.clear();
  }
}

/** The pages, drawn by EmbedPDF's Stage, which scrolls and zooms them itself. */
function DocumentPages({
  choices,
  navigation,
  selection,
  annotate,
}: {
  choices: ViewChoices;
  navigation: ReturnType<typeof withHistory>;
  selection: Selection;
  annotate: boolean;
}): React.JSX.Element {
  const paged = choices.scrollMode === "paged";
  return (
    <>
      <RestorePosition restore={navigation.restore} />
      <Stage
        className="viewport"
        // The Stage has no scrolling element, so no native scrollbars: its own
        // are drawn over it, except where a page is turned, not scrolled.
        overlay={
          paged ? undefined : (
            <>
              <Scrollbar axis="y" />
              <Scrollbar axis="x" />
            </>
          )
        }
      >
        {(page) => (
          <Page
            page={page}
            highlight={navigation.highlight}
            region={selection.region}
            annotate={annotate}
            paged={paged}
            onOpenPage={(target, top) => navigation.goToPage(target, top)}
          />
        )}
      </Stage>
    </>
  );
}

/**
 * Puts the reader back where they were. A sibling before the Stage: its
 * layout effect runs before the Stage's, so the restored position is what
 * the Stage lays out first (see `useRestorePosition`).
 */
function RestorePosition({
  restore,
}: {
  restore: Parameters<typeof useRestorePosition>[0];
}): null {
  useRestorePosition(restore);
  return null;
}
