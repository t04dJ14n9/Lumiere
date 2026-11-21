/**
 * The `sandbox` of a tab's editor frame: what a note's or PDF's page may do
 * beyond running its own scripts on the window's origin.
 *
 * It keeps `allow-same-origin`, so it does not isolate the page: script that
 * ran in it could reach the window's DOM and lift the sandbox. The page needs
 * the origin today: the server's token cookie (SameSite=Strict) and its
 * Origin and fetch-metadata checks refuse an opaque origin's requests and
 * socket, the window adds its key listener to the page's own window
 * (`forwardFrameShortcuts`), both sides check each message's origin against
 * their own, the page keeps its state in `sessionStorage`, and in the web
 * app a service worker serves the page and its files, which it does not do
 * for an opaque origin. What keeps a note's content from running is the
 * page's nonce-only script policy and the sanitizer.
 *
 * What the sandbox still takes away is what no page does: navigating the
 * window (a link with `target="_top"`), downloads, dialogs (`alert`,
 * `print`) and plugins. Kept:
 * - `allow-popups` and `allow-popups-to-escape-sandbox`: a web link opens a
 *   window of its own (host-node's page/ui.ts), unsandboxed;
 * - `allow-presentation`, which a video player's frame in a note asks for
 *   (onlineVideos' `PLAYER_SANDBOX`): a frame gets no more than its parent;
 * - `allow-forms` for a PDF only: the password prompt is a form, and a
 *   sandbox without it fires no `submit`. A note's page has no form, and its
 *   sanitizer drops any a note holds.
 */
import type { FileKind } from "../shared/file-kind";

const PAGE_SANDBOX = [
  "allow-scripts",
  "allow-same-origin",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-presentation",
];

export function editorFrameSandbox(kind: FileKind): string {
  return (
    kind === "pdf" ? [...PAGE_SANDBOX, "allow-forms"] : PAGE_SANDBOX
  ).join(" ");
}
