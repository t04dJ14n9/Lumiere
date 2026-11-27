import type { Plugin } from "@workshop/core";
import { contributionId } from "../../shared/setting-schema";
import type {} from "../editor/api";
import { protocol } from "../commands/protocol";
import { protocol as editorProtocol } from "../editor/protocol";
import { registerModeStatus } from "./mode-status";
export const livePreviewHost: Plugin = {
  name: "livePreview",
  inject: {
    required: ["hostCommands", "editors", "activeEditor"],
    optional: ["views"],
  },
  apply(ctx) {
    ctx.effect(() =>
      ctx.hostCommands.register(
        contributionId("toggleSourceMode"),
        async () => {
          const panel = ctx.editors.active();
          // Where the host has its own text editor (VS Code), Source mode is
          // that editor: the same switch as Toggle Text Editor. A note already
          // in Lumiere's Source mode (the default mode setting) goes back to
          // Live Preview.
          if (
            ctx.activeEditor.hasTextEditor &&
            (!panel ||
              (await panel.rpc.call(editorProtocol, "captureView", {})).mode !==
                "source")
          ) {
            return ctx.hostCommands.execute(contributionId("toggleTextEditor"));
          }
          return panel?.rpc.call(protocol, "run", {
            command: "editor:toggle-source",
          });
        },
      ),
    );
    registerModeStatus(ctx);
  },
};
