/**
 * The parts of DSH's plugin context this bundle uses, declared here so the
 * bundle needs none of DSH's packages (they ship inside DSH and change
 * between previews). Checked against DSH 0.2.1-rc.2's
 * `@deepseek-ai/dsh-host-webserver` and `@deepseek-ai/dsh-client-connection`,
 * and, for sessions, against 0.2.2-rc.1's `@deepseek-ai/dsh-session` and
 * `@deepseek-ai/dsh-session-persistence`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

export interface DshWebRoute {
  readonly kind: "exact" | "prefix";
  readonly path: string;
  handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
}

export interface DshUpgradeRoute {
  /** An exact pathname; the query string is the handler's. */
  readonly path: string;
  handler(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void | Promise<void>;
}

export interface DshWebServer {
  register(route: DshWebRoute): () => void;
  registerUpgrade(route: DshUpgradeRoute): () => void;
}

export interface DshConnection {
  /** DSH's Host/Origin fence and browser authentication: a status to answer with, or undefined to admit. */
  requestRejection(request: IncomingMessage): number | undefined;
}

export interface DshLogger {
  debug?(message: string, ...details: unknown[]): void;
  info?(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

/** The part of a session's header that names its workspace. */
export interface DshSessionHeader {
  /** The absolute working directory the session was created in, if any. */
  readonly cwd?: string;
}

/** `ctx.sessions`: the sessions live in this process. */
export interface DshSessions {
  get(id: string): { readonly header: DshSessionHeader } | undefined;
}

/** `ctx.sessionPersistence`: every stored session, live or not. Optional in a composition. */
export interface DshSessionPersistence {
  stat(id: string): Promise<{ readonly header: DshSessionHeader } | undefined>;
}

export interface DshContext {
  readonly webServer: DshWebServer;
  readonly connection: DshConnection;
  readonly sessions: DshSessions;
  /** A service this plugin did not inject; undefined when it is not mounted. */
  get(name: "sessionPersistence"): DshSessionPersistence | undefined;
  /** Run `start`; its returned cleanup runs when the plugin stops. */
  effect(start: () => () => void | Promise<void>, label?: string): unknown;
  logger?(name: string): DshLogger;
}
