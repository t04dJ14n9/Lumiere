/**
 * stdio <-> HTTP shim for the Lumiere PDF bridge, for MCP clients
 * configured with a command (Claude Code, Codex). It forwards JSON-RPC
 * messages to the bridge of the window whose workspace contains the
 * client's working directory, or to the one named by AGENT_PDF_BRIDGE_PID;
 * see discovery.ts for how (and when it refuses to) choose. When that
 * window closes or reloads, the next message chooses again (upstream.ts).
 *
 *     claude mcp add agent-pdf-viewer -- node bridge-stdio.js
 */
import { readdirSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { Upstream } from "./upstream";
import {
  chooseBridge,
  parseBridgeRecord,
  type BridgeRecord,
} from "./discovery";

const DIR =
  process.env.AGENT_PDF_BRIDGE_DIR ??
  path.join(os.homedir(), ".agent-pdf-viewer", "bridges");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readRecords(): BridgeRecord[] {
  let files: string[];
  try {
    files = readdirSync(DIR).filter((file) => file.endsWith(".json"));
  } catch {
    return [];
  }
  return files.flatMap((file) => {
    try {
      const record = parseBridgeRecord(
        JSON.parse(readFileSync(path.join(DIR, file), "utf8")),
      );
      return record ? [record] : [];
    } catch {
      return [];
    }
  });
}

const stdio = new StdioServerTransport();

/** Choose the bridge (see discovery.ts) and connect to it. */
async function connect(): Promise<StreamableHTTPClientTransport> {
  const choice = chooseBridge(readRecords(), {
    cwd: process.cwd(),
    alive,
    pid: process.env.AGENT_PDF_BRIDGE_PID,
  });
  if ("error" in choice) {
    throw new Error(choice.error);
  }
  const { bridge } = choice;
  const transport = new StreamableHTTPClientTransport(new URL(bridge.url), {
    requestInit: { headers: { Authorization: `Bearer ${bridge.token}` } },
  });
  transport.onmessage = (message) => {
    stdio.send(message).catch(report);
  };
  transport.onerror = () => upstream.drop(transport);
  transport.onclose = () => upstream.drop(transport);
  await transport.start();
  bridges.set(transport, bridge);
  return transport;
}

/** The bridge each connection went to. */
const bridges = new WeakMap<StreamableHTTPClientTransport, BridgeRecord>();

/**
 * Gone: its window removed its discovery file (a closing window does, as
 * its process ends) or its process no longer exists (a crash).
 */
function isGone(transport: StreamableHTTPClientTransport): boolean {
  const bridge = bridges.get(transport);
  return (
    !bridge ||
    !alive(bridge.pid) ||
    !readRecords().some(
      (record) => record.url === bridge.url && record.pid === bridge.pid,
    )
  );
}

const upstream = new Upstream({ open: connect, isGone });

/** Detached work's error sink: stderr, which MCP clients show as the server's log. */
function report(error: unknown): void {
  process.stderr.write(
    `agent-pdf-viewer bridge: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}

stdio.onmessage = (message: JSONRPCMessage) => {
  (async () => {
    try {
      await upstream.send(message);
    } catch (error) {
      if ("id" in message && "method" in message) {
        await stdio.send({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32000,
            message: String(error instanceof Error ? error.message : error),
          },
        });
      }
    }
  })().catch(report);
};
stdio.start().catch((error) => {
  report(error);
  process.exitCode = 1;
});
