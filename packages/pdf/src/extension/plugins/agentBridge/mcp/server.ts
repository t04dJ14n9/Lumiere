/**
 * Agent bridge server: a local MCP server (Streamable HTTP on 127.0.0.1,
 * random port, bearer token) that hands the live PDF / note selection to
 * coding agents. It is announced to:
 *
 *   VS Code (Copilot Chat)  vscode.lm.registerMcpServerDefinitionProvider
 *   Cursor                  vscode.cursor.mcp.registerServer, as a stdio server (the shim)
 *   Claude Code, Codex      a discovery file read by the stdio shim
 *                           (`claude mcp add` / `codex mcp add` -- node <shim>)
 *
 * The token travels only in the `Authorization` header: the HTTP clients get
 * it from their registration, the shim from the discovery file.
 *
 * `controller.ts` decides when it runs.
 *
 * Invariants:
 *
 * - Everything `startAgentBridge` sets up (the HTTP server and its
 *   connections, the discovery file, the editor registrations) is undone by
 *   the returned `dispose()`, and by nothing else. `dispose()` resolves only
 *   when that is done: the listener is closed (connections still open after
 *   a grace period are cut), requests in progress have finished or been cut
 *   off, and the discovery file is gone. A failing step is logged and does
 *   not stop the others.
 * - If starting fails part way, what it set up so far is undone (and
 *   awaited) before the error propagates.
 * - The token never reaches the log: request URLs are logged as a fixed
 *   route label, and every logged line is scrubbed of the token.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, copyFile } from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import * as vscode from "vscode";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { tokenScrubber } from "./scrub";
import { announce, workspaceFolderPaths } from "./discovery-file";
import { DISCOVERY_DIR, type BridgeInfo } from "./constants";
import type { BridgeDeps } from "./deps";
import { registerWithEditor } from "./register";
import { createBridgeServer } from "./tools";

/** How long open connections get to finish when the bridge stops. */
const SHUTDOWN_GRACE_MS = 2000;

export interface RunningBridge {
  info: BridgeInfo;
  /** Undo everything; resolves when it is undone (see the invariants). */
  dispose(): Promise<void>;
}

export interface BridgeLog {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ServerOptions {
  extensionUri: vscode.Uri;
  /** Where the stable copy of the stdio shim goes. */
  shim: string;
  /** What the tools read (see `BridgeDeps`); nothing in it is disposed here. */
  deps: BridgeDeps;
  log: BridgeLog;
  /** Where to announce the bridge for the stdio shim; tests use a temp folder. */
  discoveryDir?: string;
  shutdownGraceMs?: number;
}

/** One step of undo; may be async, and is awaited. */
type Undo = () => unknown;

export async function startAgentBridge(
  options: ServerOptions,
): Promise<RunningBridge> {
  // Undone in reverse if a later step fails; handed to the caller on success.
  const undo: Undo[] = [];
  const token = randomBytes(24).toString("hex");
  // The whole startup boundary is scrubbed, rollback logs and the error the
  // caller gets included: an adapter's error may quote the URL or header.
  const scrub = tokenScrubber(token);
  try {
    return await listen(options, undo, token, scrub);
  } catch (error) {
    for (const failure of await undoAll(undo)) {
      options.log.error(scrub(`Agent bridge rollback: ${describe(failure)}`));
    }
    // eslint-disable-next-line preserve-caught-error -- a cause may quote the token; only the scrubbed message leaves
    throw new Error(scrub(describe(error)));
  }
}

/** Run every step, last first, awaiting each; returns the errors. */
async function undoAll(steps: Undo[]): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const step of steps.splice(0).reverse()) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

/**
 * The route a request asked for, as a fixed label: never the URL itself,
 * which a client may have put anything in.
 */
export function routeLabel(url: string | undefined): string {
  const first = (url ?? "").split(/[/?#]/u)[1];
  if (first === "mcp") {
    return "/mcp";
  }
  if (first === ".well-known") {
    return "/.well-known";
  }
  return "another path";
}

async function listen(
  options: ServerOptions,
  undo: Undo[],
  token: string,
  scrub: (text: string) => string,
): Promise<RunningBridge> {
  const log: BridgeLog = {
    info: (message) => options.log.info(scrub(message)),
    warn: (message) => options.log.warn(scrub(message)),
    error: (message) => options.log.error(scrub(message)),
  };
  // The scrubbing log, never options.log: request errors may quote the token.
  const context: RequestContext = { token, log, deps: options.deps };
  const port = await startHttp(
    context,
    undo,
    options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS,
  );
  const info: BridgeInfo = {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    pid: process.pid,
    appName: vscode.env.appName,
    workspaceFolders: workspaceFolderPaths(),
    startedAt: new Date().toISOString(),
  };
  log.info(
    `Agent bridge listening on ${info.url} (AGENT_PDF_BRIDGE_PID ${info.pid} picks this window)`,
  );
  await announce(info, {
    discoveryDir: options.discoveryDir ?? DISCOVERY_DIR,
    port,
    undo,
    log,
  });
  const shim = await copyShim(options, log);
  registerWithEditor({
    info,
    shim: { path: shim, discoveryDir: options.discoveryDir ?? DISCOVERY_DIR },
    undo,
    log,
  });
  const steps = undo.splice(0);
  let stopping: Promise<void> | undefined;
  return {
    info,
    dispose: () =>
      (stopping ??= (async () => {
        for (const failure of await undoAll(steps)) {
          log.error(`Agent bridge cleanup: ${describe(failure)}`);
        }
      })()),
  };
}

/** What serving a request needs. */
interface RequestContext {
  token: string;
  log: BridgeLog;
  deps: BridgeDeps;
}

/** Listen on a random loopback port; returns it. Closing is added to `undo`. */
async function startHttp(
  context: RequestContext,
  undo: Undo[],
  graceMs: number,
): Promise<number> {
  const requests = new Set<Promise<void>>();
  const httpServer = http.createServer((req, res) => {
    const request = serve(req, res, context).catch((error) =>
      context.log.error(`Agent bridge request failed: ${describe(error)}`),
    );
    requests.add(request);
    void request.finally(() => requests.delete(request));
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  undo.push(() => closeServer(httpServer, requests, graceMs));
  return (httpServer.address() as AddressInfo).port;
}

/** Serve one request: loopback only, token required, no browser origins (DNS rebinding). */
async function serve(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  context: RequestContext,
): Promise<void> {
  const { token, log } = context;
  const route = routeLabel(req.url);
  if (req.headers.origin) {
    log.warn(
      `Agent bridge rejected ${req.method} ${route}: requests from a browser origin are not served`,
    );
    res.writeHead(403).end();
    return;
  }
  // Only the header carries the token: a URL ends up in logs and histories.
  if (!sameSecret(req.headers.authorization, `Bearer ${token}`)) {
    log.warn(`Agent bridge rejected ${req.method} ${route}: no valid token`);
    // 404 for OAuth discovery probes (/.well-known/...), so clients don't start an OAuth flow.
    res.writeHead(route === "/mcp" ? 401 : 404).end();
    return;
  }
  if (route !== "/mcp") {
    res.writeHead(404).end();
    return;
  }
  try {
    await serveMcp(req, res, context);
  } catch (error) {
    log.error(`Agent bridge request failed: ${describe(error)}`);
    if (!res.headersSent) {
      res.writeHead(500).end();
    }
  }
}

/**
 * Whether `candidate` is `expected`, taking as long whatever it is: an
 * early-exit compare tells another local process how much of a guess was
 * right. Only the length (fixed by the token) can differ in time.
 */
function sameSecret(candidate: string | undefined, expected: string): boolean {
  const given = Buffer.from(candidate ?? "");
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** Answer an MCP request with a fresh, stateless server and transport. */
async function serveMcp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  { deps, log }: RequestContext,
): Promise<void> {
  const server = createBridgeServer(deps);
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
  }); // no session id: stateless
  res.on("close", () => {
    transport
      .close()
      .catch((error) =>
        log.warn(`Agent bridge transport close: ${describe(error)}`),
      );
    server
      .close()
      .catch((error) =>
        log.warn(`Agent bridge server close: ${describe(error)}`),
      );
  });
  // The SDK's own types disagree under exactOptionalPropertyTypes
  // (its transport's optional callbacks); the object is the SDK's.
  await server.connect(
    transport as unknown as Parameters<typeof server.connect>[0],
  );
  await transport.handleRequest(req, res);
}

/**
 * A stable copy of the shim, so `claude mcp add` survives extension updates;
 * returns the shim to start. The bundled one stands in when the copy fails.
 */
async function copyShim(
  options: ServerOptions,
  log: BridgeLog,
): Promise<string> {
  const bundled = vscode.Uri.joinPath(
    options.extensionUri,
    "dist",
    "pdf",
    "bridge-stdio.js",
  ).fsPath;
  try {
    await mkdir(path.dirname(options.shim), { recursive: true });
    await copyFile(bundled, options.shim);
    return options.shim;
  } catch (error) {
    log.warn(`Could not copy the stdio shim: ${describe(error)}`);
    return bundled;
  }
}

/**
 * Stop listening and wait until the server has closed: idle connections go
 * at once, busy ones get `graceMs` to finish and are then cut. Requests in
 * progress are awaited too (bounded by the same grace period plus the cut).
 */
async function closeServer(
  server: http.Server,
  requests: Set<Promise<void>>,
  graceMs: number,
): Promise<void> {
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server.closeIdleConnections();
  if (await within(Promise.all([closed, ...requests]), graceMs)) {
    return;
  }
  server.closeAllConnections();
  await closed;
  await within(Promise.all([...requests]), graceMs);
}

/** Whether `promise` settled within `ms`; its rejection propagates. */
async function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
