import type { EditorView } from "@codemirror/view";
import { ViewPlugin } from "@codemirror/view";
import type { Context, Plugin } from "@workshop/core";
import type {} from "../editor/api";
import type {} from "../resources/api";
import type {} from "../render/api";
import type {} from "../commands/api";
import { protocol as links } from "../links/protocol";
import { linkPreviews } from "./controller";
import { linkAtCaret } from "./caret";
export const pagePreviewWebview: Plugin = {
  name: "pagePreview",
  inject: { required: ["editor", "resources", "render", "rpc", "commands"] },
  apply(ctx) {
    registerPreviewController(ctx);
  },
};

function registerPreviewController(ctx: Context): void {
  let previews: ReturnType<typeof linkPreviews> | undefined;
  // Lumiere's own command, with no key: Alt+Enter is Follow Link's, as in
  // Obsidian, whose Page Preview has no command.
  ctx.effect(() =>
    ctx.commands.register("page-preview:preview-link", () => {
      const link = linkAtCaret(ctx.editor.view);
      if (!link || !previews) {
        return false;
      }
      previews.preview(link);
      return true;
    }),
  );
  ctx.effect(() =>
    ctx.editor.extend(
      ViewPlugin.fromClass(
        class {
          readonly controller: ReturnType<typeof linkPreviews>;
          constructor(view: EditorView) {
            this.controller = linkPreviews(
              view.dom,
              () => ({
                render: ctx.render,
                resources: ctx.resources,
                open(href, source, wiki = false) {
                  void ctx.rpc
                    .call(links, "open", {
                      href,
                      ...(source === undefined ? {} : { source }),
                      wiki,
                      side: false,
                    })
                    .catch((error) =>
                      ctx.logger.warn("Preview navigation failed", error),
                    );
                },
              }),
              () => view.focus(),
            );
            previews = this.controller;
          }
          update(update: { docChanged: boolean }): void {
            if (update.docChanged) {
              this.controller.close();
            }
          }
          destroy(): void {
            this.controller.dispose();
            if (previews === this.controller) {
              previews = undefined;
            }
          }
        },
      ),
    ),
  );
}
