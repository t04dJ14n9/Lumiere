import type { Plugin } from "@workshop/core";
import { contributionId } from "../../shared/setting-schema";
import type {} from "../editor/api";
import { protocol } from "../commands/protocol";
import { registerModeStatus } from "./mode-status";
export const livePreviewHost: Plugin = {
  name: "livePreview",
  inject: { required: ["hostCommands", "editors"], optional: ["views"] },
  apply(ctx) {
    ctx.effect(() =>
      ctx.hostCommands.register(contributionId("toggleSourceMode"), () =>
        ctx.editors
          .active()
          ?.rpc.call(protocol, "run", { command: "editor:toggle-source" }),
      ),
    );
    registerModeStatus(ctx);
  },
};
