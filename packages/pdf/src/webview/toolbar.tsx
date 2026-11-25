import { useStageState } from "@embedpdf/react/stage";
import React from "react";
import type { ToolMode, ViewerAction } from "../shared/view-state";
import { postToHost } from "./host";
import type { Navigation } from "./navigation";
import { MAX_ZOOM, MIN_ZOOM } from "../shared/zoom-steps";
import { NumberField } from "./number-field";
import { fitMode } from "./view-sync";
import type { ViewChoices } from "../shared/view-settings";
import { ViewControls } from "./view-controls";
import { t } from "@workshop/l10n";

const MAC = /Mac|iPhone|iPad/u.test(navigator.userAgent);

/** A keyboard shortcut as the platform writes it, for tooltips. */
function shortcut(mac: string, other: string): string {
  return MAC ? mac : other;
}

/** The viewer's controls, each also a command with a keyboard shortcut. */
export interface ToolbarProps {
  navigation: Navigation;
  tool: ToolMode;
  /** Empty-page / Select Region; hide the region tool when off. */
  regionsEnabled: boolean;
  choices: ViewChoices;
  run: (action: ViewerAction) => void;
  history: {
    back: boolean;
    forward: boolean;
    onBack(): void;
    onForward(): void;
  };
}

function IconButton({
  icon,
  label,
  keys,
  disabled,
  pressed,
  onClick,
}: {
  icon: string;
  /** The accessible name; the tooltip adds the shortcut. */
  label: string;
  keys?: string;
  disabled?: boolean;
  /** For toggles: whether this one is on. */
  pressed?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`icon-button${pressed ? " pressed" : ""}`}
      aria-label={label}
      title={keys ? `${label} (${keys})` : label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <i className={`codicon codicon-${icon}`} aria-hidden="true" />
    </button>
  );
}

/**
 * The page, zoom, fit, tool, outline and find controls, in groups. The
 * buttons run the same actions as the extension's commands.
 */
function ToolbarControls({
  navigation,
  tool,
  regionsEnabled,
  choices,
  run,
  history,
}: ToolbarProps): React.JSX.Element {
  return (
    <>
      <HistoryGroup history={history} />
      <span className="separator" />
      <PageGroup navigation={navigation} run={run} />
      <span className="separator" />
      <ZoomGroup run={run} />
      <span className="separator" />
      <ViewControls choices={choices} run={run} />
      <span className="separator" />
      <ToolGroup tool={tool} regionsEnabled={regionsEnabled} run={run} />
      <span className="spacer" />
      <span className="toolbar-group">
        <IconButton
          icon="list-tree"
          label={t("Toggle outline")}
          keys={shortcut("⌃⌘O", "Ctrl+Alt+O")}
          onClick={() => postToHost({ type: "toggleOutline" })}
        />
        <IconButton
          icon="search"
          label={t("Find in PDF")}
          keys={shortcut("⌘F", "Ctrl+F")}
          onClick={() => run({ action: "find" })}
        />
      </span>
    </>
  );
}

type Run = ToolbarProps["run"];

function HistoryGroup({
  history,
}: Pick<ToolbarProps, "history">): React.JSX.Element {
  return (
    <span className="toolbar-group">
      <IconButton
        icon="arrow-left"
        label={t("Back to previous location")}
        disabled={!history.back}
        onClick={history.onBack}
      />
      <IconButton
        icon="arrow-right"
        label={t("Forward to next location")}
        disabled={!history.forward}
        onClick={history.onForward}
      />
    </span>
  );
}

function PageGroup({
  navigation,
  run,
}: {
  navigation: Navigation;
  run: Run;
}): React.JSX.Element {
  const { currentPage, pageCount } = navigation;
  return (
    <span className="toolbar-group">
      <IconButton
        icon="chevron-up"
        label={t("Previous page")}
        keys="Alt+PageUp"
        disabled={!navigation.canGoBack}
        onClick={() => run({ action: "previousPage" })}
      />
      <NumberField
        label={t("Page")}
        value={currentPage}
        suffix={t("of {0}", pageCount)}
        onCommit={(page) => {
          if (!Number.isInteger(page)) {
            return false;
          }
          const target = Math.min(Math.max(1, page), pageCount);
          run({ action: "goToPage", page: target });
          return target;
        }}
      />
      <IconButton
        icon="chevron-down"
        label={t("Next page")}
        keys="Alt+PageDown"
        disabled={!navigation.canGoForward}
        onClick={() => run({ action: "nextPage" })}
      />
    </span>
  );
}

function ZoomGroup({ run }: { run: Run }): React.JSX.Element {
  const { zoomLevel, zoomMode } = useStageState();
  const fit = fitMode(zoomMode);
  return (
    <span className="toolbar-group">
      <IconButton
        icon="zoom-out"
        label={t("Zoom out")}
        keys={shortcut("⌘-", "Ctrl+-")}
        onClick={() => run({ action: "zoomOut" })}
      />
      <NumberField
        label={t("Zoom")}
        value={Math.round(zoomLevel * 100)}
        suffix="%"
        onCommit={(percent) => {
          const level = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, percent / 100));
          run({ action: "setZoom", percent: level * 100 });
          return Math.round(level * 100);
        }}
      />
      <IconButton
        icon="zoom-in"
        label={t("Zoom in")}
        keys={shortcut("⌘=", "Ctrl+=")}
        onClick={() => run({ action: "zoomIn" })}
      />
      <IconButton
        icon="arrow-both"
        label={t("Fit width")}
        keys={shortcut("⌘0", "Ctrl+0")}
        pressed={fit === "width"}
        onClick={() => run({ action: "fitWidth" })}
      />
      <IconButton
        icon="screen-full"
        label={t("Fit page")}
        keys={shortcut("⌥⌘0", "Ctrl+Alt+0")}
        pressed={fit === "page"}
        onClick={() => run({ action: "fitPage" })}
      />
    </span>
  );
}

function ToolGroup({
  tool,
  regionsEnabled,
  run,
}: {
  tool: ToolMode;
  regionsEnabled: boolean;
  run: Run;
}): React.JSX.Element {
  return (
    <span className="toolbar-group">
      <IconButton
        icon="whole-word"
        label={t("Select text")}
        keys={shortcut("⌃⌘T", "Ctrl+Alt+T")}
        pressed={tool === "text"}
        onClick={() => run({ action: "setTool", tool: "text" })}
      />
      {regionsEnabled && (
        <IconButton
          icon="inspect"
          label={t("Select region")}
          keys={shortcut("⌃⌘R", "Ctrl+Alt+R")}
          pressed={tool === "region"}
          onClick={() => run({ action: "setTool", tool: "region" })}
        />
      )}
    </span>
  );
}

/** The controls as a slim bar along the top of the viewer (`toolbar.mode`: `slim`). */
export function Toolbar(props: ToolbarProps): React.JSX.Element {
  return (
    <div className="toolbar" role="toolbar" aria-label={t("PDF toolbar")}>
      <ToolbarControls {...props} />
    </div>
  );
}
