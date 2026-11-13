/**
 * Lumière's editor routes (host-node) on DSH's own web server, behind DSH's
 * browser authentication: a request DSH would refuse never reaches them.
 */
import type { IncomingMessage } from "node:http";
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
        const handled = await routes
          .handle(req, res)
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
