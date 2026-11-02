import { getSyncedVersion, sendableUpdates } from "@codemirror/collab";
import type { Plugin } from "@workshop/core";
import type {} from "../editor/api";
import { protocol } from "./protocol";
import { readingPositionReporter } from "./reading-position";

/**
 * Tells the host's Markdown Outline where the reader is as the note
 * scrolls, so the outline follows reading as well as the caret.
 */
export const outlineWebview: Plugin = {
  name: "outline",
  inject: { required: ["editor", "rpc"] },
  apply(ctx) {
    // Read once: the editor can report while the plugin is stopping.
    const rpc = ctx.rpc;
    ctx.effect(() =>
      ctx.editor.extend(
        readingPositionReporter((view, offset) => {
          // An unsent edit: the offset may not match the host's text yet,
          // and the host follows again once the edit arrives.
          if (sendableUpdates(view.state).length > 0) {
            return;
          }
          rpc.notify(
            protocol,
            "readingPosition",
            { offset, version: getSyncedVersion(view.state) },
            { coalesce: true },
          );
        }),
      ),
    );
  },
};
