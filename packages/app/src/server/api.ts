/**
 * The server's own API (contract.ts, docs/HOSTS_PLAN.md section 5): health,
 * vaults, files, opening a note or folder, drawings for the window's canvas
 * (ink.ts), and an event stream the shell listens to, so an "open" from the
 * desktop app (a deep link, a file opened from Finder) and a drawing to make
 * reach the window.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { fromShell } from "./auth";
import type { WindowInk } from "./ink";
import type { UiStore } from "./ui-state";
import type { VaultEvent, Vaults } from "./vaults";

/** Request bodies are small JSON objects. */
const MAX_BODY = 64 * 1024;
/** But for a drawing: every point of a page of handwriting, kept raw. */
const MAX_DRAWING_BODY = 64 * 1024 * 1024;
/** Opens kept for a window that has not connected yet; the newest win. */
const MAX_WAITING = 16;
/**
 * The routes that can add a folder as a vault, and so widen what the editor
 * pages may read and write. A page of a note is same-origin with the window,
 * so these answer the window only (auth.ts `fromShell`).
 */
const ADDS_A_FOLDER = new Set(["POST /api/vaults", "POST /api/open"]);

export interface Api {
  /** Answer a request under `/api/`; false when its path is not one of these. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  /** End every event stream (the server is stopping). */
  close(): void;
}

/** A vault event, or a drawing started or ended waiting (GET /api/ink). */
export type ServerEvent = VaultEvent | { readonly type: "ink" };

export interface ApiState {
  readonly vaults: Vaults;
  readonly ui: UiStore;
  readonly ink: WindowInk;
  /** What the window's page was given to prove it, not a page in it, adds a folder. */
  readonly shellKey: string;
  /** Start Insert Sketch in the note last focused (the window's pencil). */
  readonly insertSketch: () => void;
  readonly version: string;
}

/**
 * The open event streams, each with the event types it asked for
 * (`?only=ink`), or undefined for every type.
 */
type Streams = Map<ServerResponse, ReadonlySet<string> | undefined>;

export function createApi(state: ApiState): Api {
  const { vaults, ui, version } = state;
  const streams: Streams = new Map();
  const waiting = relayEvents(state, streams);
  return {
    async handle(req, res) {
      const url = new URL(req.url ?? "/", "http://host");
      const route = `${req.method ?? "GET"} ${url.pathname}`;
      if (refusedFromPage(route, { req, res }, state.shellKey)) {
        return true;
      }
      switch (route) {
        case "GET /api/health":
          return json(res, 200, { ok: true, version });
        case "GET /api/ui":
          return json(res, 200, ui.get());
        case "POST /api/ui":
          return json(res, 200, await ui.update(await jsonBody(req)));
        case "GET /api/vaults":
          return json(res, 200, vaults.list());
        case "POST /api/vaults":
          return json(res, 200, {
            vault: await vaults.add(await pathBody(req)),
          });
        case "DELETE /api/vaults":
          await vaults.close(await pathBody(req, url));
          return json(res, 200, vaults.list());
        case "POST /api/open":
          await vaults.show(await pathBody(req));
          return json(res, 200, { ok: true });
        case "GET /api/files":
          return json(res, 200, {
            files: await vaults.files(url.searchParams.get("vault") ?? ""),
          });
        case "GET /api/events":
          openStream(res, { url, streams, waiting });
          return true;
        default:
          return drawingRoute(route, { req, res }, state);
      }
    },
    close() {
      for (const stream of streams.keys()) {
        stream.end();
      }
      streams.clear();
    },
  };
}

/** Answer 403, and say so, for a route that adds a folder when a page, not the window, asks. */
function refusedFromPage(
  route: string,
  { req, res }: { req: IncomingMessage; res: ServerResponse },
  shellKey: string,
): boolean {
  if (!ADDS_A_FOLDER.has(route) || fromShell(req, shellKey)) {
    return false;
  }
  return json(res, 403, { error: "Only the window may open a folder" });
}

/**
 * Drawings for the window's canvas (ink.ts), and the window's pencil
 * starting one; false for any other route.
 */
async function drawingRoute(
  route: string,
  { req, res }: { req: IncomingMessage; res: ServerResponse },
  { ink, insertSketch }: Pick<ApiState, "ink" | "insertSketch">,
): Promise<boolean> {
  switch (route) {
    case "GET /api/ink":
      return json(res, 200, ink.request() ?? {});
    case "POST /api/ink": {
      const { id, sketch } = inkBody(await jsonBody(req, MAX_DRAWING_BODY));
      ink.answer(id, sketch);
      return json(res, 200, { ok: true });
    }
    case "POST /api/sketch":
      insertSketch();
      return json(res, 200, { ok: true });
    default:
      return false;
  }
}

/**
 * Send vault events and drawings to every open event stream that takes
 * them. Notes to open that come before a stream that takes them (the
 * window's, not its canvas's `?only=ink`) wait in the returned list: the
 * desktop app passes a note from Finder while its window is still loading,
 * and the window's two streams connect in either order. A window that
 * connects later reads a drawing with GET /api/ink.
 */
function relayEvents(
  { vaults, ink }: Pick<ApiState, "vaults" | "ink">,
  streams: Streams,
): VaultEvent[] {
  const waiting: VaultEvent[] = [];
  const broadcast = (event: ServerEvent): boolean => {
    let sent = false;
    for (const [stream, types] of streams) {
      if (accepts(types, event.type)) {
        sendEvent(stream, event);
        sent = true;
      }
    }
    return sent;
  };
  vaults.onEvent((event) => {
    if (!broadcast(event) && event.type === "open") {
      waiting.push(event);
      if (waiting.length > MAX_WAITING) {
        waiting.shift();
      }
    }
  });
  ink.onChange(() => broadcast({ type: "ink" }));
  return waiting;
}

function accepts(
  types: ReadonlySet<string> | undefined,
  type: string,
): boolean {
  return types === undefined || types.has(type);
}

function json(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
  return true;
}

/** A JSON request body, optionally larger than the usual API limit. */
async function jsonBody(
  req: IncomingMessage,
  limit = MAX_BODY,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/** `{"path": "/absolute/path"}` from the query string or request body. */
async function pathBody(req: IncomingMessage, url?: URL): Promise<string> {
  const query = url?.searchParams.get("path");
  if (query) {
    return query;
  }
  const body = await jsonBody(req);
  const value = (body as { path?: unknown } | null)?.path;
  if (typeof value !== "string" || value === "") {
    throw new Error('Expected {"path": "<absolute path>"}');
  }
  return value;
}

/** `{"id":"..."}` with optional `sketch` (undefined means cancelled). */
function inkBody(body: unknown): { id: string; sketch: string | undefined } {
  const value = body as { id?: unknown; sketch?: unknown } | null;
  if (typeof value?.id !== "string" || value.id === "") {
    throw new Error('Expected {"id": "<drawing id>"}');
  }
  if (value.sketch === undefined) {
    return { id: value.id, sketch: undefined };
  }
  if (typeof value.sketch !== "string") {
    throw new Error("Expected sketch to be a string");
  }
  return { id: value.id, sketch: value.sketch };
}

/**
 * Server-sent events: one `data:` line of JSON per vault event, of the types
 * the stream asked for (`?only=a,b`) or of every type. A stream that takes
 * notes to open is sent those waiting for one.
 */
function openStream(
  res: ServerResponse,
  {
    url,
    streams,
    waiting,
  }: { url: URL; streams: Streams; waiting: VaultEvent[] },
): void {
  const only = url.searchParams.get("only");
  const types = only ? new Set(only.split(",")) : undefined;
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  res.write(": lumiere\n\n");
  streams.set(res, types);
  res.on("close", () => streams.delete(res));
  if (accepts(types, "open")) {
    for (const event of waiting.splice(0)) {
      sendEvent(res, event);
    }
  }
}

function sendEvent(stream: ServerResponse, event: ServerEvent): void {
  stream.write(`data: ${JSON.stringify(event)}\n\n`);
}
