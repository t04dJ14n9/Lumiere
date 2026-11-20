import type { Plugin } from "@workshop/core";
import type { ActiveEditor, HostDocument, PanelPort } from "../../shared/host";
import type { EditorPanel, Editors } from "../editor/api";
import { protocol as editorProtocol } from "../editor/protocol";
import { countText, formatCounts, type Counts } from "./count";

const UPDATE_DELAY_MS = 200;
/** Do not block the status bar on a webview that is still booting (BH-018). */
const SELECTION_WAIT_MS = 50;

/** The status bar word count for the active note or its selection. */
export const wordCountHost: Plugin = {
  name: "wordCount",
  inject: {
    required: ["hostDocuments", "views", "activeEditor"],
    optional: ["editors"],
  },
  apply(ctx) {
    const status = ctx.views.status("lumiere.markdown.wordCount", 99);
    ctx.effect(() => () => status.dispose());
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    const counter = new PanelCounter();
    const update = async () => {
      const gen = ++generation;
      const uri = ctx.activeEditor.note();
      const text = await activeText({
        activeEditor: ctx.activeEditor,
        editors: ctx.editors,
        counter,
        uri,
      });
      if (gen !== generation) {
        return;
      }
      if (text === undefined) {
        status.hide();
        return;
      }
      status.show(formatCounts(text), "Words and characters");
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void update(), UPDATE_DELAY_MS);
    };
    ctx.effect(() => () => clearTimeout(timer));
    ctx.effect(() => ctx.activeEditor.onNoteChanged(schedule));
    ctx.effect(() => ctx.activeEditor.onTextSelectionChanged(schedule));
    ctx.effect(() => ctx.hostDocuments.onChange(schedule));
    ctx.on("editor/selectionChanged", (panel, hasSelection) => {
      counter.selectionChanged(panel, hasSelection);
      schedule();
    });
    ctx.on("editor/opened", schedule);
    ctx.on("editor/activeChanged", schedule);
    ctx.on("editor/ready", schedule);
    void update();
  },
};

/**
 * Counts for the active note. Prefer host/panel document text so a cold
 * webview (blank for seconds on first open) cannot leave the previous note's
 * counts on the status bar. Selection is a best-effort refinement with a
 * short timeout. A text editor on the note wins over a Lumiere editor that is
 * not the active one (another group): the reader is looking at the text editor.
 */
async function activeText(options: {
  activeEditor: ActiveEditor;
  editors: Editors | undefined;
  counter: PanelCounter;
  uri: string | undefined;
}): Promise<Counts | undefined> {
  const { activeEditor, editors, counter } = options;
  const uri = options.uri ?? activeEditor.note();
  if (!uri) {
    return undefined;
  }
  const active = editors?.active();
  if (active?.document.uri === uri) {
    return counter.counts(active);
  }
  const editor = activeEditor.textEditor(uri);
  if (editor) {
    return editor.selection
      ? countText(editor.selection, false)
      : countText(editor.text);
  }
  const panel = editors?.all().find((item) => item.document.uri === uri);
  return panel ? counter.counts(panel) : undefined;
}

/**
 * Each note's counts while its version stands. Every caret move asks again,
 * and counting a long note takes a while; its text changes only with the version.
 */
const noteCounts = new WeakMap<
  HostDocument,
  { version: number; counts: Counts }
>();

function documentCounts(document: HostDocument): Counts {
  const cached = noteCounts.get(document);
  if (cached && cached.version === document.version) {
    return cached.counts;
  }
  const counts = countText(document.getText());
  if (typeof document.version === "number") {
    noteCounts.set(document, { version: document.version, counts });
  }
  return counts;
}

/**
 * Counts for a Lumiere editor. The selected text is fetched from the webview
 * only when it last reported a selection.
 */
class PanelCounter {
  private readonly empty = new WeakMap<PanelPort, boolean>();

  selectionChanged(panel: PanelPort, hasSelection: boolean): void {
    this.empty.set(panel, !hasSelection);
  }

  async counts(panel: EditorPanel): Promise<Counts> {
    if (this.empty.get(panel)) {
      return documentCounts(panel.document);
    }
    const selection = await Promise.race([
      panel.rpc
        .call(editorProtocol, "captureSelection", {})
        .catch(() => undefined),
      new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), SELECTION_WAIT_MS),
      ),
    ]);
    return selection?.text
      ? countText(selection.text, false)
      : documentCounts(panel.document);
  }
}
