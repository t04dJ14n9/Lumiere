import { protocol as links } from "../links/protocol";
import { EditorView } from "@codemirror/view";
import type { Context, Plugin } from "@workshop/core";
import { footnoteRegistry } from "../../markdown/metadata/footnote-extract";
import { footnoteCarry } from "./carry";
import { gainedFootnoteMarker, hasFootnoteMarker } from "./marker-presence";
import type { Footnote } from "../../markdown/metadata/footnotes";
import type {} from "../editor/api";
import type {} from "../commands/api";
import { documentTree } from "../livePreview/api";
import type { RenderPass } from "../render/api";
import { footnoteInline } from "./inline";
import { insertFootnote } from "./edit";
import { editDefinition } from "./definition-popover";
import { RenderedReferences } from "./render-references";
import { selectFootnoteDefinition } from "./select-definition";
export const footnotesWebview: Plugin = {
  name: "footnotes",
  inject: { required: ["editor", "commands", "livePreview", "render", "rpc"] },
  apply(ctx) {
    registerDefinitionInvalidation(ctx);
    const view = ctx.editor.view;
    const references = new RenderedReferences(
      () => view.state.doc,
      ctx.render,
      (note, pass) => navigateReference(ctx, note, pass),
    );
    ctx.effect(() => () => references.dispose());
    registerInlineReferences(ctx);
    ctx.on("render/preProcess", (pass) => references.prepare(pass));
    ctx.on("render/postProcess", (pass) => references.mount(pass));
    registerInsertFootnote(ctx);
  },
};

function registerDefinitionInvalidation(ctx: Context): void {
  let active = true;
  let key = "";
  // Whether the note holds `[^`; unknown until its first edit.
  let hasMarker: boolean | undefined;
  ctx.effect(() => () => {
    active = false;
  });
  ctx.effect(() => ctx.editor.extend(footnoteCarry));
  ctx.effect(() =>
    ctx.editor.extend(
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) {
          return;
        }
        const { doc } = update.state;
        hasMarker =
          hasMarker === undefined
            ? hasFootnoteMarker(doc)
            : hasMarker || gainedFootnoteMarker(update.changes, doc);
        if (key === "" && !hasMarker) {
          return;
        }
        // Shared with Live Preview's references (cached per document).
        const definitions = footnoteRegistry(
          doc,
          update.state.field(documentTree, false),
        ).definitions;
        if (!definitions.length) {
          // The last `[^` may have gone; look again only in such a note.
          hasMarker = hasFootnoteMarker(doc);
        }
        // What rendered blocks show of the footnotes, not where they are:
        // their positions move with every edit above them.
        const next = definitions.length
          ? JSON.stringify(
              definitions.map((note) => [note.label, note.number, note.text]),
            )
          : "";
        if (next === key) {
          return;
        }
        key = next;
        queueMicrotask(() => {
          if (active) {
            ctx.emit("render/changed");
          }
        });
      }),
    ),
  );
}

function registerInlineReferences(ctx: Context): void {
  ctx.effect(() =>
    ctx.livePreview.inline(
      footnoteInline(ctx.render, (jump) => ctx.editor.navigate(jump)),
    ),
  );
}

function registerInsertFootnote(ctx: Context): void {
  const view = ctx.editor.view;
  let closePopover = () => {};
  ctx.effect(() => () => closePopover());
  ctx.effect(() =>
    ctx.commands.register("editor:insert-footnote", () => {
      const { label, reference, ...edit } = insertFootnote(view.state);
      view.dispatch(edit);
      closePopover();
      closePopover = editDefinition(view, label, reference);
      return true;
    }),
  );
}

function navigateReference(
  ctx: Context,
  note: Footnote,
  pass: RenderPass,
): void {
  const view = ctx.editor.view;
  if (pass.documentUri) {
    void ctx.rpc
      .call(links, "open", {
        href: "",
        source: pass.documentUri,
        at: note.from,
        wiki: false,
        side: false,
      })
      .catch((error) => ctx.logger.warn("Footnote navigation failed", error));
    return;
  }
  ctx.editor.navigate(() => selectFootnoteDefinition(view, note.from));
}
