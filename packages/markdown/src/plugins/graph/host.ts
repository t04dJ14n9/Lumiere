import type { Plugin } from "@workshop/core";
import type {} from "../vault/api";
import { contributionId } from "../../shared/setting-schema";
import { createGraphSession } from "./session";

/** Window panel for one vault's graph. It does not follow the active note later. */
export const graphHost: Plugin = {
  name: "graph",
  inject: {
    required: [
      "settings",
      "vaults",
      "hostCommands",
      "views",
      "dialogs",
      "activeEditor",
    ],
  },
  apply(ctx) {
    const session = createGraphSession(ctx);
    ctx.effect(() => () => session.dispose());
    ctx.effect(() =>
      ctx.hostCommands.register(contributionId("graph.open"), () => {
        void session.open().catch((error) => {
          ctx.logger.error("Vault graph open failed", error);
        });
      }),
    );
    ctx.effect(() =>
      ctx.hostCommands.register(contributionId("graph.chooseVault"), () => {
        void session.choose().catch((error) => {
          ctx.logger.error("Vault graph vault choice failed", error);
        });
      }),
    );
    ctx.on("vault/changed", () => session.schedule());
    ctx.on("vault/resolved", () => session.schedule());
    ctx.effect(() => ctx.settings.onChange(() => session.schedule()));
  },
};
