/**
 * The host services VS Code's window provides (messages, prompts, the
 * clipboard, the active editor), done by the editor page the reader is in.
 */
import type { Disposer } from "@workshop/core";
import {
  MARKDOWN_EDITOR,
  type ActiveEditor,
  type Clipboard,
  type Dialogs,
  type PickItem,
} from "@workshop/markdown/portable";
import { questionId, type LivePanel } from "./panel";
import type { PanelHub } from "./panels";
import { MAX_ROWS, type PickRow } from "../protocol";

/** The page to show something on: the active one, else the newest. */
export function presentingPanel(panels: PanelHub): LivePanel | undefined {
  return panels.active() ?? panels.all().at(-1);
}

export function createDialogs(
  panels: PanelHub,
  log: (message: string) => void,
): Dialogs {
  const id = questionId;
  // A note's last page closes before its save runs, so a failed save has no
  // page to tell: the next page that opens shows it.
  const unseenErrors: string[] = [];
  panels.onOpened((panel) => {
    for (const message of unseenErrors.splice(0)) {
      panel.tell({ type: "toast", kind: "error", message });
    }
  });
  return {
    error: (message) => {
      if (!toast(panels, log, "error", message)) {
        unseenErrors.push(message);
      }
    },
    inform: (message) => toast(panels, log, "info", message),
    async ask(message, actions) {
      const panel = presentingPanel(panels);
      const answer = await panel?.ask({
        type: "ask",
        id: id(),
        message,
        actions: [...actions],
      });
      return typeof answer === "string" && actions.includes(answer)
        ? answer
        : undefined;
    },
    pick: (options) => pick(panels, id(), options),
    pickMany: (options) => pickMany(panels, id(), options),
    input: (options) => input(panels, id, options),
  };
}

/** Whether a page was there to show the toast. */
function toast(
  panels: PanelHub,
  log: (message: string) => void,
  kind: "info" | "error",
  message: string,
): boolean {
  log(message);
  const panel = presentingPanel(panels);
  panel?.tell({ type: "toast", kind, message });
  return panel !== undefined;
}

async function pick<T>(
  panels: PanelHub,
  id: number,
  options: {
    placeholder: string;
    items(query: string): readonly PickItem<T>[];
  },
): Promise<{ item?: PickItem<T>; query: string } | undefined> {
  const panel = presentingPanel(panels);
  if (!panel) {
    return undefined;
  }
  let query = "";
  let items = options.items(query);
  // The page filters by asking again as the reader types.
  const stop = panel.onUi((event) => {
    if (event.type === "query" && event.id === id) {
      query = event.query;
      items = options.items(query);
      panel.tell({ type: "pickItems", id, items: rows(items) });
    }
  });
  try {
    const answer = await panel.ask({
      type: "pick",
      id,
      placeholder: options.placeholder,
      items: rows(items),
    });
    if (answer === null) {
      return undefined;
    }
    const item = typeof answer === "number" ? items[answer] : undefined;
    return item ? { item, query } : { query };
  } finally {
    stop();
  }
}

/** The checklist: the page answers with the row numbers it left ticked. */
async function pickMany<T>(
  panels: PanelHub,
  id: number,
  options: { placeholder: string; items: readonly PickItem<T>[] },
): Promise<T[] | undefined> {
  const items = options.items.slice(0, MAX_ROWS);
  const answer = await presentingPanel(panels)?.ask({
    type: "pickMany",
    id,
    placeholder: options.placeholder,
    items: rows(items, MAX_ROWS),
  });
  if (!Array.isArray(answer)) {
    return undefined;
  }
  // The page is untrusted: keep only rows that exist, once each, in row order.
  return [...new Set(answer)]
    .filter((index) => index < items.length)
    .sort((a, b) => a - b)
    .map((index) => items[index]!.value);
}

function rows<T>(items: readonly PickItem<T>[], limit = 200): PickRow[] {
  return items.slice(0, limit).map((item) => ({
    label: item.label,
    ...(item.description === undefined
      ? {}
      : { description: item.description }),
    ...(item.detail === undefined ? {} : { detail: item.detail }),
  }));
}

/** The page cannot run `validate`, so a rejected value is asked for again with its error. */
async function input(
  panels: PanelHub,
  id: () => number,
  options: Parameters<Dialogs["input"]>[0],
): Promise<string | undefined> {
  const panel = presentingPanel(panels);
  let value = options.value;
  let error: string | undefined;
  for (;;) {
    const answer = await panel?.ask({
      type: "input",
      id: id(),
      prompt: options.prompt,
      value,
      ...(error === undefined ? {} : { error }),
    });
    if (typeof answer !== "string") {
      return undefined;
    }
    error = options.validate(answer);
    if (error === undefined) {
      return answer;
    }
    value = answer;
  }
}

/**
 * How long a read waits for the page: the browser may first ask the reader
 * (a permission prompt, WebKit's Paste button).
 */
export const CLIPBOARD_READ_MS = 15_000;

/**
 * The browser holds the clipboard, so reads and writes go through the page.
 * A page the browser refuses (no permission, no recent gesture), or none,
 * gives what Lumière last wrote: the best guess there is.
 */
export function createClipboard(panels: PanelHub): Clipboard {
  let last = "";
  return {
    read: async () => {
      const panel = presentingPanel(panels);
      return panel ? ((await readFromPage(panel)) ?? last) : last;
    },
    write: async (text) => {
      last = text;
      presentingPanel(panels)?.tell({ type: "clipboard", text });
    },
  };
}

/** The page's clipboard text; undefined when it refused, closed or did not answer. */
function readFromPage(panel: LivePanel): Promise<string | undefined> {
  const id = questionId();
  return new Promise((resolve) => {
    const finish = (text: string | undefined) => {
      clearTimeout(timer);
      stopListening();
      void stopWaitingForClose();
      resolve(text);
    };
    const timer = setTimeout(() => finish(undefined), CLIPBOARD_READ_MS);
    const stopListening = panel.onUi((event) => {
      if (event.type === "clipboard" && event.id === id) {
        finish(event.text ?? undefined);
      }
    });
    const stopWaitingForClose = panel.shell.onDispose(() => finish(undefined));
    panel.tell({ type: "readClipboard", id });
  });
}

export function createActiveEditor(panels: PanelHub): ActiveEditor {
  return {
    note: () => panels.active()?.document.uri,
    onNoteChanged: (listener: () => void): Disposer =>
      panels.onActiveChanged(listener),
    // Notes open only in Lumière here; there is no text editor to read.
    textEditor: () => undefined,
    onTextSelectionChanged: () => () => {},
    customEditorViewType: () =>
      panels.active() ? MARKDOWN_EDITOR.viewType : undefined,
    // One view per note outside VS Code, so Toggle Text Editor leaves no sibling tab.
    closeSiblingTabs: async () => {},
  };
}
