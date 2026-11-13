/**
 * The editor's pages and files, for any web server: a note's editor page,
 * the built editor, the page shim, a note's images, the page's socket, the
 * plugins' tree views (view-routes.ts) and the settings (settings-routes.ts).
 * Authentication is the caller's: DSH checks its own, the app its token.
 */
import { realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as path from "node:path";
import type { Duplex } from "node:stream";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import {
  pluginTitles,
  settingsUnavailableIn,
} from "@workshop/markdown/portable";
import { NODE_HOST_OFFERS } from "./inert";
import { injectShim, socketSource } from "./page";
import { pageQuery } from "./page-query";
import type { PageSocket, PanelUrls } from "./panel";
import {
  assertContained,
  fileUriToPath,
  isInsideRegisteredRoot,
  resolveContainedNote,
} from "./paths";
import type { LumiereHost } from "./start";
import { createPdfRoutes, NO_PDF_ROUTES, type PdfRoutes } from "./pdf-routes";
import { serveFile, serveStatic } from "./static";
import { createCommandRoutes } from "./command-routes";
import { createSettingsRoutes } from "./settings-routes";
import { createViewRoutes } from "./view-routes";

/** Every route below lives under this path. */
export const BASE = "/lumiere";
export const SOCKET_PATH = `${BASE}/socket`;

/** Where the routes find what they serve. */
export interface EditorAssets {
  /** The built editor (`packages/markdown/dist`). */
  readonly markdown: string;
  /** The built page shim (`page/shim.js`). */
  readonly shim: string;
  /** The built PDF viewer (`packages/pdf/dist/webview`); without it PDFs do not open. */
  readonly pdf?: string;
  /** Where the PDF viewer's problems go (a file it cannot read). */
  readonly log?: (message: string) => void;
}

export interface EditorRoutes {
  /** Answer a request under `BASE`; false when its path is not one of these routes. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  /** Take a page's socket upgrade; false when the request is not one. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  /** End every page's socket; the routes take no more. */
  close(): void;
}

export function createEditorRoutes(
  host: LumiereHost,
  assets: EditorAssets,
): EditorRoutes {
  // Each panel's workspace root: what its page may read files from.
  const roots = new Map<string, string>();
  const sockets = new WebSocketServer({ noServer: true });
  const views = createViewRoutes(host.trees);
  const pdf = assets.pdf
    ? createPdfRoutes({
        base: BASE,
        viewer: assets.pdf,
        roots: () => host.workspaceRoots(),
        log: assets.log ?? (() => {}),
      })
    : NO_PDF_ROUTES;
  const settings = createSettingsRoutes(
    host.settings,
    pluginTitles(),
    settingsUnavailableIn(NODE_HOST_OFFERS),
  );
  const commands = host.commands
    ? createCommandRoutes(host.commands)
    : undefined;
  return {
    async handle(req, res) {
      const url = new URL(req.url ?? "/", "http://host");
      const range = req.headers.range;
      if (url.pathname === BASE) {
        return serveIndex(res, {
          pdf: Boolean(assets.pdf),
          commands: !!commands,
        });
      }
      if (!url.pathname.startsWith(BASE + "/")) {
        return false;
      }
      const rest = url.pathname.slice(BASE.length);
      return dispatchRoute({
        parts: { host, assets, views, settings, commands, pdf, roots },
        req,
        res,
        url,
        rest,
        range,
      });
    },
    upgrade: (req, socket, head) =>
      acceptSocket({ host, pdf, sockets, req, socket, head }),
    close() {
      // A server's close() waits for every connection to end, and pages keep
      // their sockets open: end them, or the server never stops.
      for (const client of sockets.clients) {
        client.terminate();
      }
      sockets.close();
      views.close();
      pdf.close();
    },
  };
}

interface RouteParts {
  readonly host: LumiereHost;
  readonly assets: EditorAssets;
  readonly views: ReturnType<typeof createViewRoutes>;
  readonly settings: ReturnType<typeof createSettingsRoutes>;
  readonly commands: ReturnType<typeof createCommandRoutes> | undefined;
  readonly pdf: PdfRoutes;
  readonly roots: Map<string, string>;
}

interface RouteRequest {
  readonly parts: RouteParts;
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly url: URL;
  readonly rest: string;
  readonly range: string | undefined;
}

/** Answer one request below BASE; false when no route claims it. */
async function dispatchRoute(options: RouteRequest): Promise<boolean> {
  const { parts, req, res, url, rest, range } = options;
  if (rest === "/editor") {
    await servePage({ req, res, url, host: parts.host, roots: parts.roots });
  } else if (rest.startsWith("/m/")) {
    await serveStatic(res, parts.assets.markdown, rest.slice(3), range);
  } else if (rest === "/page/shim.js") {
    await serveFile(res, parts.assets.shim, range);
  } else if (rest === "/file") {
    await serveResource(req, res, url, parts.roots);
  } else if (rest === "/views" || rest.startsWith("/views/")) {
    return parts.views.handle(req, res, rest.slice("/views".length));
  } else if (rest === "/settings") {
    return parts.settings.handle(req, res, "");
  } else if (rest === "/commands" && parts.commands) {
    return parts.commands.handle(req, res, "");
  } else {
    // The PDF routes answer false for anything that is not theirs.
    return parts.pdf.handle(req, res, rest);
  }
  return true;
}

interface SocketRequest {
  readonly host: LumiereHost;
  readonly pdf: PdfRoutes;
  readonly sockets: WebSocketServer;
  readonly req: IncomingMessage;
  readonly socket: Duplex;
  readonly head: Buffer;
}

/** A page's socket to its panel; false when the request is not one. */
function acceptSocket({
  host,
  pdf,
  sockets,
  req,
  socket,
  head,
}: SocketRequest): boolean {
  const url = new URL(req.url ?? "/", "http://host");
  const id = url.searchParams.get("panel") ?? "";
  const panel = host.panels.get(id);
  // A PDF page uses the same shim, so the same socket path.
  const pdfPage = panel ? undefined : pdf.page(id);
  if (url.pathname !== SOCKET_PATH || (!panel && !pdfPage)) {
    return false;
  }
  sockets.handleUpgrade(req, socket, head, (ws) => {
    const page: PageSocket = {
      send: (text) => ws.send(text),
      onMessage: (listener) => {
        const receive = (data: unknown) => listener(String(data));
        ws.on("message", receive);
        return () => {
          ws.off("message", receive);
        };
      },
      onClose: (listener) => {
        ws.on("close", listener);
        return () => {
          ws.off("close", listener);
        };
      },
      close: () => ws.close(),
    };
    if (panel) {
      host.panels.attach(panel.id, page);
    } else {
      pdfPage?.attach(page);
    }
  });
  return true;
}

interface PageRequest {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly url: URL;
  readonly host: LumiereHost;
  readonly roots: Map<string, string>;
}

async function servePage({
  req,
  res,
  url,
  host,
  roots,
}: PageRequest): Promise<void> {
  const query = pageQuery(url);
  if (!query) {
    res.writeHead(400, { "content-type": "text/plain" }).end("Not a note");
    return;
  }
  // Both canonical, and the note inside the workspace even through symlinks.
  const resolved = await resolveContainedNote(query.note, query.root);
  if (!resolved) {
    res.writeHead(403).end();
    return;
  }
  const rootUri = pathToFileURL(resolved.root).toString();
  // The query comes from a page on the embedder's own origin, so it is not
  // trusted to name a workspace: the embedder registered it (`addRoot`) or
  // the page is refused.
  if (!isInsideRegisteredRoot(host.workspaceRoots(), rootUri)) {
    res.writeHead(403).end();
    return;
  }
  const { id, html } = await host.panels.open({
    uri: pathToFileURL(resolved.note).toString(),
    urls: (panelId) => panelUrls(panelId, req.headers.host ?? ""),
  });
  roots.set(id, rootUri);
  host.panels.get(id)?.shell.onDispose(() => roots.delete(id));
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(injectShim(html, id, `${BASE}/page/shim.js`));
}

function panelUrls(panelId: string, host: string): PanelUrls {
  return {
    // The page's socket is same-origin, but CSP 'self' does not cover ws: everywhere.
    cspSource: socketSource(host),
    asset: (relative) => `${BASE}/m/${relative}`,
    resource: (uri) =>
      `${BASE}/file?panel=${encodeURIComponent(panelId)}&uri=${encodeURIComponent(uri)}`,
  };
}

/**
 * The exact base path names the routes; an empty 404 told a client nothing.
 * Commands and PDF are listed only when this host serves them.
 */
function serveIndex(
  res: ServerResponse,
  offers: { readonly pdf: boolean; readonly commands: boolean },
): true {
  res.writeHead(200, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(
    JSON.stringify({
      name: "lumiere",
      routes: [
        `${BASE}/editor`,
        `${BASE}/m/`,
        `${BASE}/page/shim.js`,
        `${BASE}/file`,
        `${BASE}/views`,
        `${BASE}/settings`,
        ...(offers.commands ? [`${BASE}/commands`] : []),
        ...(offers.pdf ? [`${BASE}/pdf`] : []),
        SOCKET_PATH,
      ],
    }),
  );
  return true;
}

/** A file a note shows (an image, a video), from inside its workspace only. */
async function serveResource(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  roots: Map<string, string>,
): Promise<void> {
  const root = roots.get(url.searchParams.get("panel") ?? "");
  const resource = await containedResource(
    root,
    url.searchParams.get("uri") ?? "",
  );
  if (resource.status !== 200 || !resource.file) {
    res.writeHead(resource.status).end();
    return;
  }
  await serveFile(res, resource.file, req.headers.range);
}

interface ContainedResource {
  /** 403 leaves the workspace or cannot be trusted, 404 is contained but absent. */
  readonly status: 200 | 403 | 404;
  readonly file?: string;
}

/** Resolve the request to a contained file, distinguishing absent from outside. */
export async function containedResource(
  root: string | undefined,
  uri: string,
): Promise<ContainedResource> {
  if (!root) {
    return { status: 403 };
  }
  const target = fileUriToPath(uri);
  if (!target) {
    return { status: 403 };
  }
  // Existing files use the fully resolved path, including a final symlink,
  // so serveFile opens the filename that was checked. Absent resources are
  // classified through their nearest existing ancestor, which may itself be
  // named through a symlink; containment still refuses an escaping or dangling
  // link before a missing file can be reported.
  const resolved = await realpath(target).catch(() => undefined);
  if (resolved) {
    try {
      await assertContained(root, pathToFileURL(resolved).toString());
    } catch {
      return { status: 403 };
    }
    const info = await stat(resolved).catch(() => undefined);
    return info?.isFile() ? { status: 200, file: resolved } : { status: 404 };
  }
  const canonical = await canonicalAbsentTarget(target);
  if (!canonical) {
    return { status: 403 };
  }
  try {
    await assertContained(root, pathToFileURL(canonical).toString());
  } catch {
    return { status: 403 };
  }
  return { status: 404 };
}

/** Resolve the nearest existing ancestor of an absent target, keeping its suffix. */
async function canonicalAbsentTarget(
  target: string,
): Promise<string | undefined> {
  let ancestor = path.dirname(target);
  while (true) {
    const resolved = await realpath(ancestor).catch(() => undefined);
    if (resolved) {
      return path.join(resolved, path.relative(ancestor, target));
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      return undefined;
    }
    ancestor = parent;
  }
}
