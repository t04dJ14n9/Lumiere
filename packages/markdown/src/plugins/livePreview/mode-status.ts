import type { Context } from "@workshop/core";
import { t } from "@workshop/l10n";
import type { PanelPort, StatusHandle } from "../../shared/host";
import { contributionId } from "../../shared/setting-schema";
import type {} from "../editor/api";
import { protocol as editorProtocol } from "../editor/protocol";
import { protocol } from "./protocol";

type Mode = "source" | "livePreview";

/** The status bar text for a note's mode. */
export function modeStatusText(mode: Mode): { text: string; tooltip: string } {
  return mode === "source"
    ? {
        text: `$(code) ${t("Source")}`,
        tooltip: t("Source mode. Click for Live Preview."),
      }
    : {
        text: `$(eye) ${t("Live Preview")}`,
        tooltip: t("Live Preview. Click for Source mode."),
      };
}

/**
 * The active note's mode on the status bar; a click switches it. Each panel
 * reports its mode when it starts and when it changes; a panel that reported
 * before this listened is asked once.
 */
export function registerModeStatus(ctx: Context): void {
  const views = ctx.views;
  if (!views?.statusBar) {
    return;
  }
  const status = views.status("lumiere.markdown.mode", 98);
  const entry = new ModeStatus(status, () => ctx.editors.active());
  ctx.on("editor/opened", (panel) => entry.listen(panel));
  ctx.on("editor/closed", (panel) => entry.close(panel));
  ctx.on("editor/activeChanged", (panel) => entry.render(panel));
  ctx.effect(() => () => entry.dispose());
  for (const panel of ctx.editors.all()) {
    entry.listen(panel);
  }
  entry.render();
}

class ModeStatus {
  private readonly modes = new Map<string, Mode>();
  private readonly listening = new Map<string, () => void>();

  constructor(
    private readonly status: StatusHandle,
    private readonly active: () => PanelPort | undefined,
  ) {}

  render(panel: PanelPort | undefined = this.active()): void {
    const mode = panel && this.modes.get(panel.id);
    if (!panel || !mode) {
      this.status.hide();
      if (panel) {
        this.learn(panel);
      }
      return;
    }
    const { text, tooltip } = modeStatusText(mode);
    this.status.show(text, tooltip, contributionId("toggleSourceMode"));
  }

  listen(panel: PanelPort): void {
    if (this.listening.has(panel.id)) {
      return;
    }
    this.listening.set(
      panel.id,
      panel.rpc.on(protocol, "mode", ({ mode }) => this.set(panel, mode)),
    );
  }

  close(panel: PanelPort): void {
    this.listening.get(panel.id)?.();
    this.listening.delete(panel.id);
    this.modes.delete(panel.id);
    this.render();
  }

  dispose(): void {
    for (const stop of this.listening.values()) {
      stop();
    }
    this.listening.clear();
    this.status.dispose();
  }

  /** A panel that reported before this listened is asked, once. */
  private learn(panel: PanelPort): void {
    // Promise.resolve: a panel that cannot answer yet must not stop the host.
    void Promise.resolve()
      .then(() => panel.rpc.call(editorProtocol, "captureView", {}))
      .then(
        (view) => {
          if (!this.modes.has(panel.id)) {
            this.set(panel, view.mode);
          }
        },
        () => {},
      );
  }

  private set(panel: PanelPort, mode: Mode): void {
    this.modes.set(panel.id, mode);
    if (panel.active()) {
      this.render(panel);
    }
  }
}
