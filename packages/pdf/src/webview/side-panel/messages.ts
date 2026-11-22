import type { HostMessage } from "../../shared/messages";
import {
  parseBookmarkList,
  parseBookmarksProblem,
} from "../../shared/side-panel-messages";
import { rememberBookmarks } from "./bookmarks-state";
import { rememberSidePanel } from "./state";

/**
 * What the extension tells the side panel: its state (a command opened or
 * closed it) and the PDF's bookmarks. True when the message was one of these.
 */
export function handleSidePanelMessage(
  message: Exclude<HostMessage, { type: "load" }>,
): boolean {
  switch (message.type) {
    case "sidePanel":
      rememberSidePanel(message.state);
      return true;
    case "bookmarks":
      rememberBookmarks(
        parseBookmarkList(message.items),
        parseBookmarksProblem(message.problem),
      );
      return true;
    default:
      return false;
  }
}
