/**
 * The viewer tab's document: the HTML file itself, with two things put at the
 * top of its `<head>`, and no frame. The file is read in the extension host
 * and set as the panel's own page, so a page that loads relative styles,
 * scripts, images and fonts finds them through the `<base>` (the webview
 * address of the file's folder) and the vault's files it may read are the
 * panel's `localResourceRoots`, the vault and nothing else.
 *
 * The page runs in its own webview, which has its own origin, so it can reach
 * neither Lumiere's editors nor the extension. It does have VS Code's
 * `acquireVsCodeApi`, which VS Code gives every page with scripts; the host
 * registers no message handler for this panel, so nothing the page posts is
 * heard.
 */

const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * What the page may load. It is a page the reader trusts (the workspace is
 * trusted), so inline and vault scripts and styles run, and `eval` too: many
 * generated pages (charts, dashboards) need it, and a page that can run its
 * own script gains nothing from it. The policy decides where the page may
 * fetch from, not what its own code may do:
 *
 * - vault files, by `cspSource`, and `https:` for the library a page loads
 *   from a CDN (a trusted workspace only; Restricted Mode never gets here);
 * - images, fonts and media also from `data:` and `blob:`;
 * - no `command:` links, no forms that navigate (`form-action 'none'`), no
 *   `<base>` but the one put here (`base-uri`), no plugin content (`object-src`
 *   falls to `default-src 'none'`).
 */
export function viewerPolicy(cspSource: string): string {
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${cspSource} https:`,
    `style-src 'unsafe-inline' ${cspSource} https:`,
    `img-src ${cspSource} data: blob: https:`,
    `font-src ${cspSource} data: https:`,
    `media-src ${cspSource} data: blob: https:`,
    `connect-src ${cspSource} blob: https:`,
    "frame-src https:",
    `worker-src ${cspSource} blob:`,
    `base-uri ${cspSource}`,
    "form-action 'none'",
  ].join("; ");
}

/** Skip what may come before the root: space, comments, the doctype. */
function afterPrologue(html: string, from: number): number {
  let at = from;
  for (;;) {
    while (/\s/u.test(html[at] ?? "")) {
      at += 1;
    }
    if (html.startsWith("<!--", at)) {
      const end = html.indexOf("-->", at + 4);
      at = end < 0 ? html.length : end + 3;
      continue;
    }
    const declaration = /<(?:!doctype|\?)[^>]*>/iuy;
    declaration.lastIndex = at;
    const match = declaration.exec(html);
    if (!match) {
      return at;
    }
    at += match[0].length;
  }
}

function afterTag(html: string, name: string, at: number): number | undefined {
  const tag = new RegExp(`<${name}\\b[^>]*>`, "iuy");
  tag.lastIndex = at;
  const match = tag.exec(html);
  return match ? at + match[0].length : undefined;
}

/**
 * Where to put what the page needs before anything else: just inside its
 * `<head>`, or, with none, a `<head>` made for it after the `<html>` tag, the
 * doctype or the start. Only the start of the file is read for a tag, so a
 * `<head` in a script or a string later on is not taken for one.
 */
function injectionPoint(html: string): { at: number; makesHead: boolean } {
  let at = afterPrologue(html, html.startsWith("﻿") ? 1 : 0);
  at = afterTag(html, "html", at) ?? at;
  at = afterPrologue(html, at);
  const inside = afterTag(html, "head", at);
  return inside === undefined
    ? { at, makesHead: true }
    : { at: inside, makesHead: false };
}

/**
 * The page to set as the panel's HTML. `folderAddress` is the webview address
 * of the file's folder, ending in `/`. The policy and the `<base>` come first,
 * so no script or address in the file runs or resolves before them, and a
 * `<base>` of the file's own (the first one counts) is ignored. `loadedAt`
 * changes the text each time the file is opened, so VS Code loads it again
 * when the link is followed again.
 */
export function viewerDocument(options: {
  html: string;
  folderAddress: string;
  cspSource: string;
  loadedAt: number;
}): string {
  const { html, folderAddress, cspSource, loadedAt } = options;
  const injected =
    `<meta http-equiv="Content-Security-Policy" content="${escape(viewerPolicy(cspSource))}">` +
    `<base href="${escape(folderAddress)}">` +
    `<!-- Lumiere HTML viewer, loaded ${loadedAt} -->`;
  const { at, makesHead } = injectionPoint(html);
  const added = makesHead ? `<head>${injected}</head>` : injected;
  return html.slice(0, at) + added + html.slice(at);
}
