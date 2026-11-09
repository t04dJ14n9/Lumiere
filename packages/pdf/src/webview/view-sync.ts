import { useStageEvent, type StageCapability } from "@embedpdf/react/stage";
import { useCallback, useEffect, useRef } from "react";
import type { AnnotationToolId } from "../shared/annotation-tools";
import type {
  FitMode,
  ToolMode,
  ViewerAction,
  ViewState,
} from "../shared/view-state";
import type { ViewChoices } from "../shared/view-settings";
import { positionFromView } from "../shared/reading-position";
import { rememberPosition } from "./reading-position";
import { nextZoomStep } from "../shared/zoom-steps";
import { reportToHost } from "./host";
import type { Navigation } from "./navigation";
import { useStageApi, type StageApi } from "./stage-capability";
import { readingPlace } from "./stage-position";

type Annotation = {
  annotationTool: AnnotationToolId | null;
  canUndo: boolean;
  canRedo: boolean;
};

/** What a view report is made of. */
interface ViewInput {
  navigation: Navigation;
  tool: ToolMode;
  choices: ViewChoices;
  stage: ViewStage;
  annotation?: Annotation;
}

/** What a report reads from the Stage. */
type ViewStage = Pick<
  StageCapability,
  | "getCurrentDestination"
  | "getZoomLevel"
  | "getZoomMode"
  | "listVisiblePages"
  | "viewportToPage"
>;

/**
 * Keep the extension's controls (status bar, editor title actions) in step
 * with the viewer: report the page, zoom and tool after each change.
 * A pan changes the place in the page without re-rendering the viewer, so
 * the Stage's camera is listened to as well.
 */
export function useViewReporting(
  navigation: Navigation,
  tool: ToolMode,
  choices: ViewChoices,
  annotation?: Annotation,
): void {
  const stage = useStageApi();
  const latest = useRef<ViewInput>({ navigation, tool, choices, stage });
  latest.current = {
    navigation,
    tool,
    choices,
    stage,
    ...(annotation ? { annotation } : {}),
  };
  // Report each distinct view once.
  const reported = useRef<string | undefined>(undefined);
  const report = useCallback((): void => {
    const view = currentView(latest.current);
    const key = view && JSON.stringify(view);
    if (view && key !== reported.current) {
      reported.current = key;
      rememberPosition(positionFromView(view));
      reportToHost({ view });
    }
  }, []);
  useEffect(report);
  useStageEvent((stage) => stage.onCameraChanged, report);
}

/** The view to report, once the Stage has laid out a page; undefined before. */
export function currentView(state: ViewInput): ViewState | undefined {
  const { navigation, tool, choices, stage, annotation } = state;
  const { currentPage: page, pageCount, canGoBack, canGoForward } = navigation;
  const place = readingPlace(stage);
  if (!place || pageCount < 1 || page < 1) {
    return undefined;
  }
  const level = stage.getZoomLevel();
  const zoomPercent = Math.round(level * 100);
  if (zoomPercent <= 0) {
    return undefined;
  }
  const fit = fitMode(stage.getZoomMode());
  return {
    page,
    pageCount,
    zoomPercent,
    fit,
    tool,
    pageLayout: choices.pageLayout,
    scrollMode: choices.scrollMode,
    scrollDirection: choices.scrollDirection,
    canGoBack,
    canGoForward,
    readingPage: place.page,
    zoom: fit ? FIT_CHOICES[fit] : level * 100,
    top: place.top,
    left: place.left,
    ...(tool === "annotate" && annotation
      ? {
          annotationTool: annotation.annotationTool,
          canAnnotationUndo: annotation.canUndo,
          canAnnotationRedo: annotation.canRedo,
        }
      : {}),
  };
}

/** What an action works with. */
interface ActionContext {
  navigation: Navigation;
  stage: StageApi;
  openSearch: () => void;
  setTool: (tool: ToolMode) => void;
  setAnnotationTool: (tool: AnnotationToolId | null) => void;
  setAnnotationColor: (color: string) => void;
  annotationUndo: () => void;
  annotationRedo: () => void;
  deleteSelectedAnnotations: () => void;
  setChoices: (choices: Partial<ViewChoices>) => void;
}

type Handlers = {
  [K in ViewerAction["action"]]: (
    action: Extract<ViewerAction, { action: K }>,
    context: ActionContext,
  ) => void;
};

/** What each of the extension's commands does in the viewer. */
const ACTIONS: Handlers = {
  previousPage: (_, { navigation }) => navigation.step(-1),
  nextPage: (_, { navigation }) => navigation.step(1),
  previousPageKeepingPlace: (_, { navigation }) => navigation.step(-1, true),
  nextPageKeepingPlace: (_, { navigation }) => navigation.step(1, true),
  goToPage: ({ page }, { navigation }) => navigation.goToPage(page),
  // The Stage's zoom is synchronous, so a quick repeat steps from the level
  // the last one reached; the steps are Lumia's own, not the Stage's.
  zoomIn: (_, { stage }) => stepZoom(stage, 1),
  zoomOut: (_, { stage }) => stepZoom(stage, -1),
  setZoom: ({ percent }, { stage }) => stage.zoomTo(percent / 100),
  actualSize: (_, { stage }) => stage.zoomTo(1),
  fitWidth: (_, { stage }) => stage.fitWidth(),
  fitPage: (_, { navigation, stage }) => {
    // Fitting a page keeps the reader on it: the zoom change alone would
    // keep the old vertical centre, which can land on a later page.
    stage.fitPage();
    navigation.show({ page: navigation.currentPage }, undefined, 0, true);
  },
  setPageLayout: ({ pageLayout }, { setChoices }) => setChoices({ pageLayout }),
  setScrollMode: ({ scrollMode }, { setChoices }) => setChoices({ scrollMode }),
  setScrollDirection: ({ scrollDirection }, { setChoices }) =>
    setChoices({ scrollDirection }),
  find: (_, { openSearch }) => openSearch(),
  setTool: ({ tool }, { setTool }) => setTool(tool),
  setAnnotationTool: ({ tool }, { setAnnotationTool }) =>
    setAnnotationTool(tool),
  setAnnotationColor: ({ color }, { setAnnotationColor }) =>
    setAnnotationColor(color),
  annotationUndo: (_, { annotationUndo }) => annotationUndo(),
  annotationRedo: (_, { annotationRedo }) => annotationRedo(),
  deleteSelectedAnnotations: (_, { deleteSelectedAnnotations }) =>
    deleteSelectedAnnotations(),
};

function stepZoom(stage: StageApi, direction: 1 | -1): void {
  stage.zoomTo(nextZoomStep(stage.getZoomLevel(), direction));
}

/**
 * Carry out what the extension's commands ask: page, zoom, find or tool.
 * Returns a stable function, so the host listener need not be re-attached.
 */
type ViewActionOptions = {
  setChoices: (choices: Partial<ViewChoices>) => void;
  setAnnotationTool: (tool: AnnotationToolId | null) => void;
  setColor: (color: string) => void;
  undo: () => void;
  redo: () => void;
  deleteSelectedAnnotations: () => void;
};

export function useViewActions(
  navigation: Navigation,
  openSearch: () => void,
  setTool: (tool: ToolMode) => void,
  options: ViewActionOptions,
): (action: ViewerAction) => void {
  const stage = useStageApi();
  const current: ActionContext = {
    navigation,
    stage,
    openSearch,
    setTool,
    setAnnotationTool: options.setAnnotationTool,
    setAnnotationColor: options.setColor,
    annotationUndo: options.undo,
    annotationRedo: options.redo,
    deleteSelectedAnnotations: options.deleteSelectedAnnotations,
    setChoices: options.setChoices,
  };
  const latest = useRef(current);
  latest.current = current;
  return useCallback((action: ViewerAction): void => {
    runViewAction(action, latest.current);
  }, []);
}

function runViewAction(action: ViewerAction, context: ActionContext): void {
  if (action.action === "find") {
    context.navigation.intent.advance();
  } else {
    context.navigation.intent.interrupt();
  }
  (ACTIONS[action.action] as (a: ViewerAction, c: ActionContext) => void)(
    action,
    context,
  );
}

/** The fit mode a Stage zoom mode is, for the controls that show it; null for a level. */
export function fitMode(zoomMode: string): FitMode | null {
  if (zoomMode === "fit-width") {
    return "width";
  }
  return zoomMode === "fit-page" ? "page" : null;
}

/** The zoom choice for each fit mode. */
const FIT_CHOICES = { width: "fitWidth", page: "fitPage" } as const;
