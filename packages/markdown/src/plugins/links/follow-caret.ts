import { Prec, type EditorState } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import type { Context } from "@workshop/core";
import type {} from "../editor/api";
import type {} from "../commands/api";
import { caretLinkAt, ownsCaretKey } from "./caret-link";
import type { OpenLink } from "./clicks";
import type { LinkPlace } from "./api";

/**
 * Obsidian 1.15.0's link commands and their default keys: Follow Link
 * (Alt+Enter) here, Open Link in New Tab (Mod+Enter), Open Link to Side
 * (Mod+Alt+Enter).
 */
const LINK_COMMANDS = [
  { command: "editor:follow-link", key: "Alt-Enter", place: {} },
  {
    command: "editor:open-link-in-new-leaf",
    key: "Mod-Enter",
    place: { tab: true },
  },
  {
    command: "editor:open-link-in-new-split",
    key: "Mod-Alt-Enter",
    place: { side: true },
  },
] as const satisfies readonly {
  command: string;
  key: string;
  place: LinkPlace;
}[];

/**
 * Register the three link commands, the editor's own keys for them and the
 * `links` service table cells follow their links through.
 */
export function registerCaretFollowing(ctx: Context, open: OpenLink): void {
  const report = (error: unknown) =>
    ctx.logger.warn("Follow link failed", error);
  const follow = (
    view: EditorView,
    place: LinkPlace = {},
    note?: string,
  ): boolean => {
    if (!ownsCaretKey(view)) {
      return false;
    }
    const followed = followAtCaret(ctx, open, {
      state: view.state,
      place,
      note,
    });
    if (typeof followed === "boolean") {
      return followed;
    }
    void followed.catch(report);
    return true;
  };
  ctx.provide("links", { follow });
  for (const { command, place } of LINK_COMMANDS) {
    ctx.effect(() =>
      ctx.commands.register(command, async () => {
        const view = ctx.bail("editor/activeView") ?? ctx.editor.view;
        if (focusIsElsewhere(view)) {
          return false;
        }
        return followAtCaret(ctx, open, {
          state: view.state,
          place,
          note: noteBeyond(ctx, view),
        });
      }),
    );
  }
  // The same keys are VS Code keybindings too; stopping propagation keeps
  // VS Code from running a key the editor handled a second time. Hosts
  // without VS Code's keybindings have only these.
  const bindings = LINK_COMMANDS.map(({ key, place }) => ({
    key,
    run: (view: EditorView) => follow(view, place),
    stopPropagation: true,
  }));
  ctx.effect(() => ctx.editor.extend(Prec.highest(keymap.of(bindings))));
}

/** What `followAtCaret` follows: the caret's state, where it opens, its note. */
interface CaretTarget {
  state: EditorState;
  place: LinkPlace;
  /** The note's text, when `state` holds only part of it (a table cell). */
  note: string | undefined;
}

/**
 * Open what the caret is on, as Obsidian's link commands do: a link, a
 * reference link through the note's definition, or another plugin's token
 * there (Tags searches a tag). False when nothing at the caret follows.
 */
function followAtCaret(
  ctx: Context,
  open: OpenLink,
  { state, place, note }: CaretTarget,
): boolean | Promise<boolean> {
  const at = state.selection.main.head;
  const link = caretLinkAt(state.doc.toString(), at, note);
  if (link) {
    return open(link.href, link.wiki, place);
  }
  return ctx.bail("links/followToken", state, at) === true;
}

/**
 * The note's text when the active view is a part of it: a table cell's
 * editor, which holds the cell's text and none of the note's definitions.
 * The Tables plugin answers `editor/activeView` with the cell of its own
 * editor, which is this plugin's `ctx.editor`, so that editor is the note.
 */
function noteBeyond(ctx: Context, view: EditorView): string | undefined {
  const note = ctx.editor.view;
  return view === note ? undefined : note.state.doc.toString();
}

/**
 * Whether the note's focus is in a field rather than `view`'s text: a
 * property, the Vim prompt, a dialog, another editor. VS Code runs these
 * commands for keys such a field left alone, and those keys are the field's,
 * not the caret's. From the Command Palette the focus inside the note stays
 * where it was.
 */
function focusIsElsewhere(view: EditorView): boolean {
  const document = view.dom.ownerDocument;
  const active = document?.activeElement;
  return !!active && active !== view.contentDOM && active !== document.body;
}
