import type { Plugin } from "@workshop/core";
import type {} from "../commands/api";
import type {} from "../editor/api";
import type {} from "../document/api";
import { protocol } from "./protocol";
import { t } from "@workshop/l10n";
export const agentBridgeWebview: Plugin = {
  name: "agentBridge",
  inject: { required: ["editor", "commands", "document", "rpc", "menu"] },
  apply(ctx) {
    const copy = async () => {
      await ctx.document.flush();
      return ctx.rpc.call(protocol, "copy", {});
    };
    const copyNow = () => {
      void copy().catch((error) =>
        ctx.logger.warn("Copy Link for Agent failed", error),
      );
    };
    ctx.effect(() => ctx.commands.register("copyLinkForAgent", copy));
    // Always first in the selection / table context menu (user standing rule).
    ctx.on("editor/selectionMenu", (items) => [
      { label: t("Copy link to this"), run: copyNow },
      ...items,
    ]);
  },
};
