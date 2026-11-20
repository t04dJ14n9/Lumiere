import { Scrollbar, Stage } from "@embedpdf/react/stage";
import React, { useEffect, useRef, useState } from "react";
import { useEndDragsReleasedOutside } from "./drag-release";
import { usePagedDragNavigate } from "./paged-drag-navigate";
import { useNavigation } from "./navigation";
import { useOutlinePublishing } from "./outline";
import { Page } from "./page";
import { currentViewSettings, useRestorePosition } from "./reading-position";
import { isFindKey, type ViewChoices } from "../shared/view-settings";
import { usePagingKeys } from "./paging-input";
import { useSmoothMotion, useSmoothWheel } from "./smooth-scrolling";
import { zenToolbarMode } from "../shared/zen";
import { useZen } from "./zen";
import { useViewLayout } from "./view-layout";
import { useExposeStageForTests } from "./test-hook";
import { SearchBar } from "./search-bar";
import { useIgnoreSecondaryButtons } from "./secondary-buttons";
import { useLookUp } from "./look-up";
import { useSelectionReporting } from "./selection";
import { useAnnotationEditing } from "./annotation-mode";
import { useAnnotationSaveSession } from "./annotation-session";
import { useMarkMenu, type MarkMenu } from "./mark-menu";
import { NoteBadges } from "./note-badges";
import { NoteCard } from "./note-card";
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
          searching={search.isOpen}
          isOwnMark={view.isOwnMark}
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
    runAction: tools.runAction,
    isOwnMark: tools.annotationSave.isOwn,
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

/** Tool mode, marks, selection reporting, view actions and keys. */
function useViewerTools(deps: ViewerToolsDeps) {
  const { navigation, search, choices, setChoices, regionsEnabled } = deps;
  const { tool, setTool } = useToolMode(regionsEnabled);
  const editing = useAnnotationEditing();
  const annotationSave = useAnnotationSaveSession();
  // The selection reporting asks the mark menu, made after it, where a
  // context menu opened.
  const markMenu = useRef<MarkMenu | undefined>(undefined);
  const selection = useSelectionReporting((event) =>
    Boolean(markMenu.current?.openAt(event)),
  );
  markMenu.current = useMarkMenu({
    isOwn: annotationSave.isOwn,
    setAnnotationRegion: selection.setAnnotationRegion,
    setHighlightColor: editing.setHighlightColor,
  });
  const marks = markMenu.current;
  useViewReporting(navigation, tool, choices);
  const runAction = useViewActions(navigation, search.open, setTool, {
    setChoices: (next) => setChoices((current) => ({ ...current, ...next })),
    marks: {
      markSelection: marks.markSelection,
      editNote: marks.editNote,
      highlightWithNote: marks.highlightWithNote,
      setColor: marks.setColor,
      deleteMark: marks.deleteMark,
      undo: editing.undo,
      redo: editing.redo,
    },
  });
  useViewerKeys({ selection, search, tool, setTool });
  return { tool, annotationSave, selection, runAction };
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
  usePagedDragNavigate({
    mode: choices.scrollMode,
    direction: choices.scrollDirection,
    step: navigation.step,
  });
  useViewLayout(choices, smooth);
  useEndDragsReleasedOutside();
  useIgnoreSecondaryButtons(documentArea);
}

const MAC = /Mac|iPhone|iPad/u.test(navigator.userAgent);

/** Cmd/Ctrl+F opens the search bar; Escape closes it, or drops the tool or selection. */
function useViewerKeys(state: {
  selection: Selection;
  search: ReturnType<typeof useSearch>;
  tool: string;
  setTool: (tool: "text" | "region") => void;
}): void {
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const shortcuts = currentViewSettings().keyboardShortcuts !== false;
      if (isFindKey(event, { mac: MAC, shortcuts })) {
        event.preventDefault();
        latest.current.search.open();
      } else if (event.key === "Escape") {
        onEscape(latest.current);
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
  setTool: (tool: "text" | "region") => void;
}): void {
  const { search, selection, tool, setTool } = state;
  if (document.querySelector(".view-menu:popover-open")) {
    return;
  }
  if (search.isOpen) {
    search.close();
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
  searching,
  isOwnMark,
}: {
  choices: ViewChoices;
  navigation: ReturnType<typeof withHistory>;
  selection: Selection;
  searching: boolean;
  isOwnMark: React.ComponentProps<typeof NoteCard>["isOwn"];
}): React.JSX.Element {
  const paged = choices.scrollMode === "paged";
  return (
    <>
      <RestorePosition restore={navigation.restore} />
      <Stage
        className="viewport"
        // The Stage has no scrolling element, so no native scrollbars: its own
        // are drawn over it, except where a page is turned, not scrolled.
        // A mark's note icon and note card sit there too, beside the mark.
        overlay={
          <>
            {!paged && (
              <>
                <Scrollbar axis="y" />
                <Scrollbar axis="x" />
              </>
            )}
            <NoteBadges />
            <NoteCard isOwn={isOwnMark} />
          </>
        }
      >
        {(page) => (
          <Page
            page={page}
            highlight={navigation.highlight}
            region={selection.region}
            searching={searching}
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
