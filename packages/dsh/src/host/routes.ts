/**
 * Lumière's editor routes (host-node) on DSH's own web server, behind DSH's
 * browser authentication: a request DSH would refuse never reaches them.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  BASE,
  SOCKET_PATH,
  createEditorRoutes,
  type EditorAssets,
  type LumiereHost,
} from "@workshop/host-node";
import type { DshContext } from "./dsh";

const REASONS = new Map<number, string>([
  [401, "Unauthorized"],
  [403, "Forbidden"],
  [404, "Not Found"],
]);

/** An HTTP error line for an upgrade we refuse before any handshake. */
export function upgradeRejection(status: number): string {
  const reason = REASONS.get(status) ?? "Error";
  return (
    `HTTP/1.1 ${status} ${reason}\r\n` +
    "Connection: close\r\nContent-Length: 0\r\n\r\n"
  );
}

/**
 * The DSH gate answers a method none of the JSON routes uses with a
 * family-level Allow; host-node's settings, command and view handlers own each
 * resource's exact methods. Copying their table here would drift and change
 * their 404s.
 */
function isJsonRoute(rest: string): boolean {
  return (
    rest === "/views" ||
    rest.startsWith("/views/") ||
    rest === "/settings" ||
    rest === "/commands"
  );
}

/** host-node's JSON handlers dispatch on GET; Node still suppresses a HEAD body. */
function headAsGet(req: IncomingMessage): IncomingMessage {
  return new Proxy(req, {
    get(target, property) {
      return property === "method"
        ? "GET"
        : Reflect.get(target, property, target);
    },
  });
}

/** GET/HEAD for pages and files; POST only for the JSON routes; 405 otherwise. */
function rejectsMethod(
  req: IncomingMessage,
  res: ServerResponse,
  rest: string,
): boolean {
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") {
    return false;
  }
  if (isJsonRoute(rest)) {
    if (method === "POST") {
      return false;
    }
    res
      .writeHead(405, {
        allow: "GET, POST, HEAD",
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      .end(JSON.stringify({ error: "Method Not Allowed" }));
    return true;
  }
  const readOnly =
    rest === "/editor" ||
    rest === "/page/shim.js" ||
    rest === "/file" ||
    rest === "/pdf" ||
    rest.startsWith("/m/") ||
    rest.startsWith("/pdf/");
  if (!readOnly) {
    return false;
  }
  res.writeHead(405, { allow: "GET, HEAD" }).end();
  return true;
}

export function registerRoutes(
  ctx: DshContext,
  host: LumiereHost,
  assets: EditorAssets,
): void {
  const routes = createEditorRoutes(host, assets);
  const reject = (req: IncomingMessage) => ctx.connection.requestRejection(req);
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "prefix",
      path: BASE,
      handler: async (req, res) => {
        const status = reject(req);
        if (status) {
          res.writeHead(status).end();
          return;
        }
        const rest = new URL(req.url ?? "/", "http://host").pathname.slice(
          BASE.length,
        );
        if (rejectsMethod(req, res, rest)) {
          return;
        }
        // The event stream never ends; a HEAD must not open it.
        const jsonHead =
          req.method === "HEAD" &&
          isJsonRoute(rest) &&
          rest !== "/views/events";
        const handled = await routes
          .handle(jsonHead ? headAsGet(req) : req, res)
          .catch((error: unknown) => {
            ctx.logger?.("lumiere").error("Lumière route failed", error);
            if (!res.headersSent) {
              res.writeHead(500, { "content-type": "text/plain" });
            }
            // The message can name a filesystem path. The log has it; the browser does not.
            res.end("Internal error");
            return true;
          });
        if (!handled) {
          res.writeHead(404).end();
        }
      },
    }),
  );
  ctx.effect(() => {
    const stop = ctx.webServer.registerUpgrade({
      path: SOCKET_PATH,
      handler: (req, socket, head) => {
        const status = reject(req);
        if (status || !routes.upgrade(req, socket, head)) {
          // A raw upgrade socket receives no HTTP status unless we write one;
          // otherwise the browser reports an opaque connection failure. It is
          // no longer owned by node:http, so destroy it after the response
          // flushes even if the peer ignores Connection: close.
          socket.once("finish", () => {
            socket.destroy();
          });
          socket.end(upgradeRejection(status ?? 404));
        }
      },
    });
    return () => {
      stop();
      routes.close();
    };
  });
}
