import type { Plugin } from "@workshop/core";
import type { PanelPort, PanelShell } from "../../shared/host";
import type {} from "../editor/api";
import { protocol } from "./protocol";
import { t } from "@workshop/l10n";

/**
 * The panel's side: tells the editor whether the window's status bar will
 * show Vim's mode, so the editor can hide its own mode line.
 */
export const vimPanelHost: Plugin<{ panel: PanelShell }> = {
  name: "vim",
  inject: { required: ["rpc", "views"] },
  apply(ctx) {
    const { rpc, views } = ctx;
    ctx.effect(() =>
      rpc.handle(protocol, "statusBar", async () => Boolean(views.statusBar)),
    );
  },
};

/** Vim's mode for the active Lumiere editor, in the window's status bar. */
export const vimHost: Plugin = {
  name: "vim",
  inject: { required: ["views", "editors"] },
  apply(ctx) {
    if (!ctx.views.statusBar) {
      return;
    }
    const status = ctx.views.status("lumiere.markdown.vim", 100, {
      alignment: "left",
    });
    ctx.effect(() => () => status.dispose());
    const texts = new Map<string, string>();
    const listening = new Map<string, () => void>();
    const render = (panel: PanelPort | undefined = ctx.editors.active()) => {
      const text = panel && texts.get(panel.id);
      if (text) {
        status.show(text, t("Vim mode"));
      } else {
        status.hide();
      }
    };
    const listen = (panel: PanelPort) => {
      if (listening.has(panel.id)) {
        return;
      }
      listening.set(
        panel.id,
        panel.rpc.on(protocol, "status", ({ text }) => {
          texts.set(panel.id, text);
          if (panel.active()) {
            render(panel);
          }
        }),
      );
    };
    ctx.on("editor/opened", listen);
    ctx.on("editor/closed", (panel) => {
      listening.get(panel.id)?.();
      listening.delete(panel.id);
      texts.delete(panel.id);
      render();
    });
    ctx.on("editor/activeChanged", (panel) => render(panel));
    ctx.effect(() => () => {
      for (const stop of listening.values()) {
        stop();
      }
      listening.clear();
    });
    for (const panel of ctx.editors.all()) {
      listen(panel);
    }
    render();
  },
};
