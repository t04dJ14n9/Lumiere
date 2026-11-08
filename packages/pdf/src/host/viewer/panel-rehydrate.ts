import type { HostMessage } from "../../shared/messages";
import type { EffectivePageColors } from "../../shared/page-colors";
import type { ToolbarSettings } from "../../shared/toolbar-settings";
import type { PdfBacklinkOutlet } from "./pdf-backlinks";

/** Re-send toolbar / colors / history / overlays after a viewer load. */
export function rehydrateViewerChrome(args: {
  post: (message: HostMessage) => void;
  toolbar: ToolbarSettings;
  pageColorsMode: EffectivePageColors;
  historyState: { back: boolean; forward: boolean };
  lookUp: boolean;
  backlinks: PdfBacklinkOutlet;
  zen: boolean;
}): void {
  const { post } = args;
  post({ type: "toolbar", toolbar: args.toolbar });
  post({ type: "pageColors", effective: args.pageColorsMode });
  post({ type: "historyState", ...args.historyState });
  if (args.lookUp) {
    post({ type: "lookUp", enabled: true });
  }
  args.backlinks.rehydrate();
  if (args.zen) {
    post({ type: "zen", on: true });
  }
}
