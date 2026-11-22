/**
 * Where an editor's own agent learns about the bridge:
 *
 *   Cursor                  vscode.cursor.mcp.registerServer, with the stdio
 *                           shim (https://cursor.com/docs/context/mcp-extension-api)
 *   VS Code (Copilot Chat)  vscode.lm.registerMcpServerDefinitionProvider
 *
 * Cursor stubs VS Code's API ("not supported in Cursor"), and its own
 * registration drops the `headers` of a remote server (3.30.14), so it gets
 * the shim, which carries the token itself.
 */
import * as vscode from "vscode";
import { PROVIDER_ID, SERVER_NAME, type BridgeInfo } from "./constants";
import type { BridgeLog } from "./server";

/** One step of undo; may be async, and is awaited. */
type Undo = () => unknown;

export interface Registration {
  info: BridgeInfo;
  /** The shim Cursor starts, with the folder that holds the bridges' discovery files. */
  shim: { path: string; discoveryDir: string };
  undo: Undo[];
  log: BridgeLog;
}

export function registerWithEditor(registration: Registration): void {
  const apis = vscode as unknown as McpApis;
  if (typeof apis.cursor?.mcp?.registerServer === "function") {
    registerWithCursor(apis.cursor.mcp, registration);
    return;
  }
  registerWithVsCode(apis, registration);
}

/**
 * Cursor starts the shim as a stdio server, with its own Electron as the
 * Node runtime (`ELECTRON_RUN_AS_NODE`; the user needs no `node`). The shim
 * is told this window's process id, which the discovery file names, so it
 * serves this window and no other (see bridge-stdio/discovery.ts). Nothing
 * secret is registered: the shim reads the token from the discovery file.
 */
function registerWithCursor(
  mcp: NonNullable<NonNullable<McpApis["cursor"]>["mcp"]>,
  { info, shim, undo, log }: Registration,
): void {
  mcp.registerServer({
    name: SERVER_NAME,
    server: {
      command: process.execPath,
      args: [shim.path],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        AGENT_PDF_BRIDGE_PID: String(info.pid),
        AGENT_PDF_BRIDGE_DIR: shim.discoveryDir,
      },
    },
  });
  undo.push(() => mcp.unregisterServer(SERVER_NAME));
  log.info(
    "Registered with Cursor (vscode.cursor.mcp.registerServer, stdio shim)",
  );
}

function registerWithVsCode(
  apis: McpApis,
  { info, undo, log }: Registration,
): void {
  const HttpDefinition = apis.McpHttpServerDefinition;
  if (!apis.lm?.registerMcpServerDefinitionProvider || !HttpDefinition) {
    return;
  }
  const headers = { Authorization: `Bearer ${info.token}` };
  const registration = apis.lm.registerMcpServerDefinitionProvider(
    PROVIDER_ID,
    {
      provideMcpServerDefinitions: () => [
        new HttpDefinition(
          "Lumiere PDF",
          vscode.Uri.parse(info.url),
          headers,
          "0.1.0",
        ),
      ],
    },
  );
  undo.push(() => registration.dispose());
  log.info(
    "Registered with VS Code (vscode.lm.registerMcpServerDefinitionProvider)",
  );
}

/**
 * MCP registration APIs missing from the @types/vscode this builds against:
 * Cursor's own, and VS Code's server definition provider (1.101+).
 */
interface McpApis {
  cursor?: {
    mcp?: {
      registerServer(config: unknown): void;
      unregisterServer(name: string): void;
    };
  };
  lm?: {
    registerMcpServerDefinitionProvider?(
      id: string,
      provider: unknown,
    ): vscode.Disposable;
  };
  McpHttpServerDefinition?: new (
    label: string,
    uri: vscode.Uri,
    headers?: Record<string, string>,
    version?: string,
  ) => unknown;
}
