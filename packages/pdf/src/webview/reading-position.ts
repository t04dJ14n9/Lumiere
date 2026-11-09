import { ZoomMode, type ZoomSpec } from "@embedpdf/react/stage";
import { useLayoutEffect, useRef } from "react";
import {
  parseReadingPosition,
  type ReadingPosition,
} from "../shared/reading-position";
import {
  parseViewSettings,
  type ViewSettings,
  type ZoomChoice,
} from "../shared/view-settings";

let settings = parseViewSettings(undefined);
let last: ReadingPosition | undefined;

/** Prepare defaults before plugins start. A rebuilt file keeps the current panel's position. */
export function prepareReadingPosition(
  defaults: unknown,
  saved: unknown,
): void {
  settings = parseViewSettings(defaults);
  last = last ??
    parseReadingPosition(saved) ?? {
      page: 1,
      top: 0,
      left: 0,
      zoom: settings.defaultZoom,
      pageLayout: settings.pageLayout,
      scrollMode: settings.scrollMode,
      scrollDirection: settings.scrollDirection,
    };
}

export function currentViewSettings(): ViewSettings {
  return settings;
}

export function rememberViewSettings(value: unknown): ViewSettings {
  settings = parseViewSettings(value);
  return settings;
}

export function rememberPosition(position: ReadingPosition): void {
  last = position;
}

export function rememberedPosition(): ReadingPosition {
  return (
    last ?? {
      page: 1,
      top: 0,
      left: 0,
      zoom: settings.defaultZoom,
      ...settings,
    }
  );
}

/**
 * A zoom choice as the Stage's zoom intent. A level is a multiple of 1 point
 * per pixel, which is what `viewUnitsPerPoint: 1` (plugins.ts) makes of it,
 * so a saved 150% is still 150%.
 */
export function nativeZoom(choice: ZoomChoice): ZoomSpec {
  switch (choice) {
    case "fitWidth":
      return { mode: ZoomMode.FitWidth };
    case "fitPage":
      return { mode: ZoomMode.FitPage };
    case "actual":
      return { level: 1 };
    default:
      return { level: choice / 100 };
  }
}

/**
 * Put the reader back where they were, once per document.
 *
 * The Stage queues a move made before it has a size and applies it inside its
 * first layout, so the first frame painted already shows the restored page,
 * offset and zoom (no flash of page 1). Call this from a component rendered
 * before the `<Stage>`: its layout effect then runs before the Stage's, and
 * the pages of page 1 never mount and ask to be drawn.
 */
export function useRestorePosition(
  restore: (position: ReadingPosition) => void,
): void {
  const latest = useRef(restore);
  latest.current = restore;
  useLayoutEffect(() => {
    latest.current(rememberedPosition());
  }, []);
}
