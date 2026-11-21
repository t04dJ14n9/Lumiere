import type { Context, Plugin } from "@workshop/core";
import { contributionId } from "../../shared/setting-schema";
import { containedResource, contains } from "../resources/api";
import { viewerDocument } from "./document";
import {
  parseHtmlViewerRequest,
  viewerTitle,
  type HtmlViewerRequest,
} from "./request";

/** The tab's view type: one tab per file, under this one type. */
const VIEW_TYPE = contributionId("htmlViewer");

/** The largest file the tab shows: it is set as the panel's page, in one piece. */
export const MAX_HTML_BYTES = 16 * 1024 * 1024;

/**
 * Opens a vault's HTML file in a tab of its own, from a link
 * (`[Open](/wiki/diagram.html)`) or the Open button of an HTML embed. The tab
 * is a webview whose page is the file itself (document.ts), in a trusted
 * workspace only; Restricted Mode opens the file as text, as a link to it did
 * before there was a viewer. A file outside the vault is refused.
 *
 * The host listens to nothing from the page: no message handler is registered
 * for this panel, and it has no command links.
 */
export const htmlViewerHost: Plugin = {
  name: "htmlViewer",
  inject: { required: ["hostCommands", "views", "workspace", "dialogs"] },
  apply(ctx) {
    ctx.effect(() =>
      ctx.hostCommands.register(
        contributionId("htmlViewer.open"),
        (...args: unknown[]) => {
          void open(ctx, args).catch((error: unknown) => {
            ctx.logger.error("HTML viewer failed to open", error);
            ctx.dialogs.error("The HTML file could not be opened.");
          });
        },
      ),
    );
  },
};

async function open(ctx: Context, args: readonly unknown[]): Promise<void> {
  const request = parseHtmlViewerRequest(args);
  if (!request) {
    ctx.logger.warn("HTML viewer asked to open something it cannot");
    return;
  }
  // Before anything is opened, in either mode: no disk is asked, and a file
  // outside the vault is not shown or opened as text by a caller that names it.
  assertInVault(ctx, request);
  if (!ctx.workspace.isTrusted()) {
    // The page must never run here: the file is shown as text, as before, in
    // the group the link asked for (Open Link to Side).
    await ctx.hostCommands.execute(
      "vscode.open",
      request.uri,
      ...(request.column === undefined ? [] : [{ viewColumn: request.column }]),
    );
    return;
  }
  const html = await readContained(ctx, request);
  const panel = ctx.views.panel(VIEW_TYPE, viewerTitle(request.uri), {
    key: request.uri,
    resourceRoots: [request.root],
    // Whatever the page did (a diagram's state) is lost when it reloads.
    retainContext: true,
    ...(request.column === undefined ? {} : { column: request.column }),
  });
  panel.webview.setHTML(
    viewerDocument({
      html,
      folderAddress: `${panel.webview.resource(folderOf(request.uri))}/`,
      cspSource: panel.webview.cspSource,
      loadedAt: Date.now(),
    }),
  );
}

/** The file's folder, as a URI without a trailing slash. */
function folderOf(uri: string): string {
  const url = new URL(uri);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf("/"));
  return url.href.replace(/\/$/u, "");
}

/**
 * The checks that need no disk: the vault is inside a workspace folder (with
 * no workspace folder, a `file:` vault, which is where a note opened on its own
 * has one), and the file is inside the vault by path. Both modes run them
 * first, so the command, which any caller may run, never opens as text, or
 * shows, a file that is not the vault's.
 */
function assertInVault(ctx: Context, request: HtmlViewerRequest): void {
  const folders = ctx.workspace.folders();
  const isInWorkspace =
    folders.length > 0
      ? folders.some((folder) => contains(folder, request.root))
      : new URL(request.root).protocol === "file:";
  if (!isInWorkspace) {
    throw new Error("The vault is outside the workspace");
  }
  if (!contains(request.root, request.uri)) {
    throw new Error("The file is outside the vault");
  }
}

/**
 * The file's text, once it is shown to be inside the vault through symbolic
 * links too (`plugins/resources`, the rule embeds follow). The tab's resource
 * roots then hold the vault and nothing else.
 */
async function readContained(
  ctx: Context,
  request: HtmlViewerRequest,
): Promise<string> {
  const { workspace } = ctx;
  const stat = await workspace.stat(request.uri);
  const realContains = workspace.realContains?.bind(workspace);
  await containedResource(request.root, request.uri, stat.symbolicLink, {
    inspect: (uri) => workspace.stat(uri),
    ...(realContains ? { realContains } : {}),
  });
  const bytes = await workspace.read(request.uri);
  if (bytes.byteLength > MAX_HTML_BYTES) {
    throw new Error("The file is too large to show");
  }
  // UTF-8, as the page is set as text; a byte order mark is dropped.
  return new TextDecoder("utf-8").decode(bytes);
}
