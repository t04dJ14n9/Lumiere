import * as vscode from "vscode";
import { t } from "@workshop/l10n";
import {
  pageColorsLabel,
  parsePageColors,
  resolveEffective,
  type PageColorsSetting,
  type ThemeKind,
} from "../../../shared/page-colors";
import {
  parseVsCodeToolbarMode,
  showStatusBarButtons,
} from "../../../shared/toolbar-settings";
import {
  pageLabel,
  zoomLabel,
  type ViewState,
} from "../../../shared/view-state";
import type { PdfPanels } from "../pdf/panels";
import {
  HISTORY_COMMAND_IDS,
  TOOLBAR_COMMAND_IDS,
  VIEW_COMMAND_IDS,
  VIEW_CONTROL_COMMAND_IDS,
} from "../../../shared/command-ids";
import { SECTION } from "./preferences";
import { statusBarPriority, type StatusBarEntryId } from "./status-bar-layout";

/** A shortcut as this platform writes it: `key('Ctrl+G', '⌃G')`. */
function key(other: string, mac: string): string {
  return process.platform === "darwin" ? mac : other;
}

type Item = {
  id: StatusBarEntryId;
  name: string;
  text: string;
  tooltip: string;
  command: string;
  button?: true;
};

/**
 * Status bar entries, in their order from left to right (see
 * `STATUS_BAR_ORDER`): history, find, View, page colors, "Page 4 / 15", previous/next page, zoom
 * label and buttons. Optional buttons show only when
 * `toolbar.statusBarButtons` asks for them. Made when the bar is, not when
 * this module loads: their text is in the reader's language.
 */
function statusBarItems(): Item[] {
  return [...historyAndFindItems(), ...pageItems(), ...zoomItems()];
}

function historyAndFindItems(): Item[] {
  return [
    {
      id: "historyBack",
      name: t("PDF History Back"),
      text: "$(arrow-left)",
      tooltip: t("Back to previous location"),
      command: HISTORY_COMMAND_IDS.historyBack,
      button: true,
    },
    {
      id: "historyForward",
      name: t("PDF History Forward"),
      text: "$(arrow-right)",
      tooltip: t("Forward to next location"),
      command: HISTORY_COMMAND_IDS.historyForward,
      button: true,
    },
    {
      id: "find",
      name: t("PDF Find"),
      text: "$(search)",
      tooltip: t("Find in PDF ({0})", key("Ctrl+F", "⌘F")),
      command: VIEW_COMMAND_IDS.find,
      button: true,
    },
  ];
}

function pageItems(): Item[] {
  return [
    {
      id: "view",
      name: t("PDF View"),
      text: `$(layout) ${t("View")}`,
      tooltip: t("Choose zoom, page layout and scrolling"),
      command: VIEW_CONTROL_COMMAND_IDS.selectView,
    },
    {
      id: "pageColors",
      name: t("PDF Page Colors"),
      text: "",
      tooltip: t("Cycle page colors: Follow → Normal → Dark"),
      command: TOOLBAR_COMMAND_IDS.cyclePageColors,
    },
    {
      id: "page",
      name: t("PDF Page"),
      text: "",
      tooltip: t("Go to Page… ({0})", key("Ctrl+G", "⌃G")),
      command: VIEW_COMMAND_IDS.goToPage,
    },
    {
      id: "previousPage",
      name: t("PDF Previous Page"),
      text: "$(chevron-up)",
      tooltip: t("Previous Page ({0})", key("Alt+PageUp", "⌥PageUp")),
      command: VIEW_COMMAND_IDS.previousPage,
      button: true,
    },
    {
      id: "nextPage",
      name: t("PDF Next Page"),
      text: "$(chevron-down)",
      tooltip: t("Next Page ({0})", key("Alt+PageDown", "⌥PageDown")),
      command: VIEW_COMMAND_IDS.nextPage,
      button: true,
    },
  ];
}

function zoomItems(): Item[] {
  return [
    {
      id: "zoom",
      name: t("PDF Zoom"),
      text: "",
      tooltip: t("Pick a Zoom…"),
      command: VIEW_COMMAND_IDS.selectZoom,
    },
    {
      id: "zoomOut",
      name: t("PDF Zoom Out"),
      text: "$(zoom-out)",
      tooltip: t("Zoom Out ({0})", key("Ctrl+-", "⌘-")),
      command: VIEW_COMMAND_IDS.zoomOut,
      button: true,
    },
    {
      id: "zoomIn",
      name: t("PDF Zoom In"),
      text: "$(zoom-in)",
      tooltip: t("Zoom In ({0})", key("Ctrl+=", "⌘=")),
      command: VIEW_COMMAND_IDS.zoomIn,
      button: true,
    },
  ];
}

function themeKind(): ThemeKind {
  return vscode.window.activeColorTheme.kind as ThemeKind;
}

function pageColorsSetting(): PageColorsSetting {
  return parsePageColors(
    vscode.workspace.getConfiguration("lumiere.pdf").get("pageColors"),
  );
}

function pageColorsText(setting: PageColorsSetting): string {
  const label = pageColorsLabel(setting);
  if (setting !== "follow") {
    return `$(color-mode) ${label}`;
  }
  const effective = resolveEffective(setting, themeKind());
  return `$(color-mode) ${t("Follow ({0})", pageColorsLabel(effective))}`;
}

type EntryState = {
  view: ViewState;
  panel: PdfPanels["active"];
  colors: PageColorsSetting;
};

function refreshEntry(
  entry: vscode.StatusBarItem,
  item: Item,
  state: EntryState,
): void {
  const { view, panel, colors } = state;
  switch (item.id) {
    case "page":
      entry.text = pageLabel(view);
      return;
    case "zoom":
      entry.text = zoomLabel(view);
      return;
    case "pageColors":
      entry.text = pageColorsText(colors);
      entry.tooltip = t(
        "Page colors: {0} (click to cycle)",
        pageColorsLabel(colors),
      );
      return;
    case "previousPage":
      entry.command = view.canGoBack ? item.command : undefined;
      return;
    case "nextPage":
      entry.command = view.canGoForward ? item.command : undefined;
      return;
    case "historyBack":
      entry.command = panel?.historyButtons.back ? item.command : undefined;
      return;
    case "historyForward":
      entry.command = panel?.historyButtons.forward ? item.command : undefined;
      return;
    default:
      return;
  }
}

export class StatusBar implements vscode.Disposable {
  private readonly items = new Map<string, vscode.StatusBarItem>();
  private readonly definitions = statusBarItems();
  private readonly subscription: vscode.Disposable;

  constructor(private readonly panels: PdfPanels) {
    for (const item of this.definitions) {
      const entry = vscode.window.createStatusBarItem(
        `lumiere.pdf.${item.id}`,
        vscode.StatusBarAlignment.Right,
        statusBarPriority(item.id),
      );
      entry.name = item.name;
      entry.text = item.text;
      entry.tooltip = item.tooltip;
      entry.command = item.command;
      this.items.set(item.id, entry);
    }
    this.subscription = panels.onDidChange(() => this.update());
    this.update();
  }

  update(): void {
    const view = this.panels.active?.view;
    const panel = this.panels.active;
    const configuration = vscode.workspace.getConfiguration(SECTION);
    const shown =
      view !== undefined &&
      parseVsCodeToolbarMode(configuration.get("mode")) === "chrome";
    const buttons =
      shown && showStatusBarButtons(configuration.get("statusBarButtons"));
    const colors = pageColorsSetting();
    for (const item of this.definitions) {
      const entry = this.items.get(item.id)!;
      if (!shown || (item.button && !buttons)) {
        entry.hide();
        continue;
      }
      refreshEntry(entry, item, { view: view!, panel, colors });
      entry.show();
    }
  }

  dispose(): void {
    this.subscription.dispose();
    for (const entry of this.items.values()) {
      entry.dispose();
    }
  }
}
