import test from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { SOCKET_PATH, type LumiereHost } from "@workshop/host-node";
import { registerRoutes } from "../../src/host/routes";
import type { DshContext } from "../../src/host/dsh";
import { dshSessions } from "./fake-sessions";

function httpError(status: number, reason: string): string {
  return (
    `HTTP/1.1 ${status} ${reason}\r\n` +
    "Connection: close\r\nContent-Length: 0\r\n\r\n"
  );
}

function fakeHost(): LumiereHost {
  return {
    panels: {
      get: (id: string) => (id === "p" ? { id } : undefined),
      attach: () => true,
    },
    // createEditorRoutes only needs trees.onEvent at construction; views are unused here.
    trees: { onEvent: () => () => {} },
    addRoot: () => {},
    workspaceRoots: () => [],
    stop: async () => {},
  } as unknown as LumiereHost;
}

type UpgradeHandler = (
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => void | Promise<void>;

type TestContext = { after(callback: () => void): void };

function registerWithRejection(status: number | undefined): {
  upgrade: UpgradeHandler;
  close: () => void;
} {
  let upgrade: UpgradeHandler | undefined;
  const cleanups: Array<() => void | Promise<void>> = [];
  const ctx: DshContext = {
    ...dshSessions({}),
    webServer: {
      register: () => () => {},
      registerUpgrade: (route) => {
        assert.equal(route.path, SOCKET_PATH);
        upgrade = route.handler;
        return () => {};
      },
    },
    connection: {
      requestRejection: () => status,
    },
    effect(start) {
      const stop = start();
      if (typeof stop === "function") {
        cleanups.push(stop);
      }
    },
  };
  registerRoutes(ctx, fakeHost(), { markdown: "/none", shim: "/none" });
  assert.ok(upgrade, "registerUpgrade was not called");
  return {
    upgrade,
    close: () => {
      for (const stop of cleanups) {
        void stop();
      }
    },
  };
}

async function listen(
  upgrade: UpgradeHandler,
  t: TestContext,
  onUpgrade?: (socket: Duplex) => void,
): Promise<number> {
  const server = createServer((_req, res) => res.writeHead(404).end());
  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => {
      socket.destroy();
    });
    onUpgrade?.(socket);
    upgrade(req, socket, head);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.close();
  });
  return (server.address() as { port: number }).port;
}

function upgradeRequest(port: number, pathAndQuery: string): string {
  return (
    `GET ${pathAndQuery} HTTP/1.1\r\n` +
    `Host: 127.0.0.1:${port}\r\n` +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\n` +
    "Sec-WebSocket-Version: 13\r\n\r\n"
  );
}

/** A raw HTTP Upgrade request. Returns whatever the server wrote, which may be empty if it only destroyed the socket. */
function rawUpgrade(port: number, pathAndQuery: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const chunks: Buffer[] = [];
    const socket = connect({ port, host: "127.0.0.1" });
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    socket.on("connect", () => {
      socket.write(upgradeRequest(port, pathAndQuery));
    });
    socket.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (Buffer.concat(chunks).includes("\r\n\r\n")) {
        finish();
      }
    });
    socket.on("end", finish);
    socket.on("close", finish);
    socket.on("error", () => finish());
    socket.setTimeout(2000, () => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      reject(
        new Error(
          `upgrade timed out: ${Buffer.concat(chunks).toString("utf8")}`,
        ),
      );
    });
  });
}

/**
 * A rejection read by a client that keeps its write half open after the
 * server's FIN. The server must close the detached upgrade socket itself.
 */
function heldRejection(
  port: number,
  pathAndQuery: string,
  t: TestContext,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = connect({ port, host: "127.0.0.1", allowHalfOpen: true });
    let settled = false;
    t.after(() => {
      socket.destroy();
    });
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      socket.setTimeout(0);
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    socket.on("connect", () => {
      socket.write(upgradeRequest(port, pathAndQuery));
    });
    socket.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    socket.on("end", finish);
    socket.on("close", finish);
    socket.on("error", finish);
    socket.setTimeout(2000, () => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      reject(new Error("rejected upgrade did not end"));
    });
  });
}

function statusLine(response: string): string {
  return response.split("\r\n", 1)[0] ?? "";
}

test("an unauthenticated socket upgrade is answered with HTTP 401", async (t) => {
  const { upgrade, close } = registerWithRejection(401);
  t.after(close);
  const port = await listen(upgrade, t);
  // panel=p would be admitted if auth passed, so a 401 proves the short-circuit.
  const response = await rawUpgrade(port, `${SOCKET_PATH}?panel=p`);
  assert.equal(response, httpError(401, "Unauthorized"));
});

test("a rejected upgrade closes its socket after one HTTP response", async (t) => {
  const { upgrade, close } = registerWithRejection(403);
  t.after(close);
  let serverClosed = Promise.resolve();
  const port = await listen(upgrade, t, (socket) => {
    serverClosed = new Promise<void>((resolve) => {
      socket.once("close", resolve);
    });
  });
  const response = await heldRejection(port, `${SOCKET_PATH}?panel=p`, t);
  assert.equal(response, httpError(403, "Forbidden"));
  const deadline = new Promise<"timeout">((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 2000);
    timer.unref();
  });
  assert.equal(
    await Promise.race([serverClosed.then(() => "closed"), deadline]),
    "closed",
  );
});

test("an admitted upgrade for an unknown panel is answered with HTTP 404", async (t) => {
  const { upgrade, close } = registerWithRejection(undefined);
  t.after(close);
  const port = await listen(upgrade, t);
  const response = await rawUpgrade(port, `${SOCKET_PATH}?panel=nope`);
  assert.equal(response, httpError(404, "Not Found"));
});

test("an admitted upgrade for a known panel is not ended with a DSH 404", async (t) => {
  const { upgrade, close } = registerWithRejection(undefined);
  t.after(close);
  const port = await listen(upgrade, t);
  const response = await rawUpgrade(port, `${SOCKET_PATH}?panel=p`);
  assert.equal(statusLine(response), "HTTP/1.1 101 Switching Protocols");
  assert.notEqual(statusLine(response), "HTTP/1.1 404 Not Found");
});
