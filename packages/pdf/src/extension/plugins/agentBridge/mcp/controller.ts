/**
 * Agent bridge controller: decides when the local MCP server runs. It is
 * light on purpose; the server, the MCP SDK and zod live in a bundle of
 * their own (dist/agent-bridge-server.js) that is loaded only when the
 * server starts.
 *
 * Invariant: the server runs only while `lumiere.pdf.agentBridge.enabled`
 * is on, the folder is trusted, AND it has been used in this window: a PDF
 * editor was opened, or the user ran Copy MCP Setup. A trust grant starts it. Turning the setting off stops it at once, without
 * a reload; starts and stops run one at a time, in order.
 *
 * Invariant: the returned `dispose()` resolves only after the bridge has
 * fully stopped (see server.ts): a start still in progress is finished or
 * abandoned and undone first, and a start that has not yet opened its
 * listener never opens it.
 */
import * as vscode from "vscode";
import { AGENT_BRIDGE_COMMAND_IDS } from "../../../../shared/command-ids";
import { SERVER_NAME } from "./constants";
import type { BridgeDeps } from "./deps";
import type { BridgeLog, RunningBridge } from "./server";

/** Whether the user has turned the bridge on. Off by default: it starts a local server. */
export function agentBridgeEnabled(): boolean {
  return (
    vscode.workspace
      .getConfiguration("lumiere.pdf")
      .get<boolean>("agentBridge.enabled", false) === true
  );
}

export interface BridgeOptions {
  extensionUri: vscode.Uri;
  globalStorageUri: vscode.Uri;
  /** What the tools read (see `BridgeDeps`). */
  deps: BridgeDeps;
  log: BridgeLog;
  /** See ServerOptions.discoveryDir. */
  discoveryDir?: string;
  shutdownGraceMs?: number;
}

/** The running controller; `dispose()` is awaited by the plugin runtime. */
export interface AgentBridgeController {
  dispose(): Promise<void>;
}

/** Runs the bridge (see the invariants above) and registers Copy MCP Setup. */
export function registerAgentBridge(
  options: BridgeOptions,
): AgentBridgeController {
  const shim = vscode.Uri.joinPath(
    options.globalStorageUri,
    "bridge-stdio.js",
  ).fsPath;
  const bridge = new BridgeController(options, shim);
  void bridge.sync();
  const subscriptions = vscode.Disposable.from(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("lumiere.pdf.agentBridge.enabled")) {
        void bridge.sync();
      }
    }),
    options.deps.panels.onDidOpen(() => bridge.use()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => void bridge.sync()),
    vscode.commands.registerCommand(
      AGENT_BRIDGE_COMMAND_IDS.copyMcpSetup,
      async () => {
        // In an untrusted folder the setting does not take effect, so there is nothing to turn on.
        if (!vscode.workspace.isTrusted) {
          void vscode.window.showInformationMessage(
            "The agent bridge runs only in a trusted folder. Trust this folder to use it.",
          );
          return;
        }
        if (await bridgeTurnedOn()) {
          bridge.use();
          await copyMcpSetup(shim);
        }
      },
    ),
  );
  let disposing: Promise<void> | undefined;
  return {
    dispose: () =>
      (disposing ??= (async () => {
        subscriptions.dispose();
        await bridge.stop();
      })()),
  };
}

/** Starts and stops the bridge, one step at a time, towards the wanted state. */
class BridgeController {
  private running: RunningBridge | undefined;
  /**
   * Used: a PDF editor was opened in this window, or Copy MCP Setup was run.
   * Once used, the bridge stays up until the setting goes off, so an agent
   * that connected does not lose it when the last PDF closes.
   */
  private used: boolean;
  private stopped = false;
  private queue = Promise.resolve();

  constructor(
    private readonly options: BridgeOptions,
    private readonly shim: string,
  ) {
    this.used = options.deps.panels.all.length > 0;
  }

  use(): void {
    this.used = true;
    void this.sync();
  }

  /** Stop for good; waits for a start in progress, then stops what it started. */
  stop(): Promise<void> {
    this.stopped = true;
    return this.sync();
  }

  /** Queue one step towards the wanted state; the queue never rejects. */
  sync(): Promise<void> {
    const { log } = this.options;
    this.queue = this.queue.then(async () => {
      if (this.wanted() && !this.running) {
        await this.start().catch((error) =>
          log.error(`Agent bridge failed to start: ${String(error)}`),
        );
      } else if (!this.wanted() && this.running) {
        const running = this.running;
        this.running = undefined;
        await running
          .dispose()
          .then(() => log.info("Agent bridge stopped"))
          .catch((error) =>
            log.error(`Agent bridge failed to stop: ${String(error)}`),
          );
      }
    });
    return this.queue;
  }

  private wanted(): boolean {
    return (
      !this.stopped &&
      this.used &&
      agentBridgeEnabled() &&
      vscode.workspace.isTrusted
    );
  }

  private async start(): Promise<void> {
    const { startAgentBridge } = await import("./server");
    // Stopped, or turned off, while the server code loaded: do not listen.
    if (!this.wanted()) {
      return;
    }
    const bridge = await startAgentBridge({ ...this.options, shim: this.shim });
    // The setting may have changed, or the plugin stopped, while it started.
    if (this.wanted()) {
      this.running = bridge;
    } else {
      await bridge.dispose();
    }
  }
}

/** Whether the bridge is on, after offering to turn it on if it is off. */
async function bridgeTurnedOn(): Promise<boolean> {
  if (agentBridgeEnabled()) {
    return true;
  }
  const turnOn = "Turn On";
  const choice = await vscode.window.showInformationMessage(
    "The agent bridge is off. It serves the PDF selection to coding agents over a local MCP server (127.0.0.1, token-protected). Turn it on?",
    turnOn,
  );
  if (choice !== turnOn) {
    return false;
  }
  await vscode.workspace
    .getConfiguration("lumiere.pdf")
    .update("agentBridge.enabled", true, vscode.ConfigurationTarget.Global);
  return true;
}

export interface McpSetupOption {
  label: string;
  detail: string;
}

type Shell = "posix" | "powershell" | "cmd";

/**
 * Quote a filesystem path so the shell passes it on as written. Single quotes
 * are literal in POSIX shells (VS Code's globalStorage lives under
 * 'Application Support', and double quotes would still expand `$` and `\`) and
 * in PowerShell (double quotes expand `$` and the backtick). `cmd.exe` does
 * not treat single quotes as quoting; inside double quotes it expands only
 * `%NAME%`, which it cannot escape.
 */
function quoteShellPath(path: string, shell: Shell): string {
  if (shell === "cmd") {
    return `"${path.replace(/"/gu, '\\"')}"`;
  }
  if (shell === "powershell") {
    // PowerShell reads U+2018 to U+201B as single quotes too; doubling one keeps it.
    return `'${path.replace(/['\u2018-\u201b]/gu, "$&$&")}'`;
  }
  return `'${path.replace(/'/gu, "'\\''")}'`;
}

/** The `claude` and `codex` commands with the shim path quoted for one shell. */
function cliOptions(shim: string, shell: Shell): McpSetupOption[] {
  const quotedShim = quoteShellPath(shim, shell);
  const suffix = { posix: "", powershell: " (PowerShell)", cmd: " (cmd)" }[
    shell
  ];
  return [
    {
      label: `Claude Code${suffix}`,
      detail: `claude mcp add --scope user ${SERVER_NAME} -- node ${quotedShim}`,
    },
    {
      label: `Codex${suffix}`,
      detail: `codex mcp add ${SERVER_NAME} -- node ${quotedShim}`,
    },
  ];
}

/** Build the CLI commands and config snippets that wire MCP clients to the shim. */
export function mcpSetupOptions(
  shim: string,
  platform: NodeJS.Platform = process.platform,
): McpSetupOption[] {
  const node = "node";
  // Windows has two shells and no quoting that is literal in both. cmd.exe
  // cannot be given a path with `%NAME%` unexpanded, so it is not offered one.
  const commands =
    platform === "win32"
      ? [
          ...cliOptions(shim, "powershell"),
          ...(shim.includes("%") ? [] : cliOptions(shim, "cmd")),
        ]
      : cliOptions(shim, "posix");
  // JSON.stringify escapes `\` and `"` and every control character below DEL,
  // but a TOML basic string needs DEL escaped as well.
  const tomlShim = JSON.stringify(shim).replace(/\u007f/gu, "\\u007f");
  return [
    ...commands,
    {
      label: "Codex (config.toml)",
      detail: `[mcp_servers.${SERVER_NAME}]\ncommand = "${node}"\nargs = [${tomlShim}]`,
    },
    {
      label: "Project .mcp.json (Claude Code)",
      detail: JSON.stringify(
        { mcpServers: { [SERVER_NAME]: { command: node, args: [shim] } } },
        null,
        2,
      ),
    },
  ];
}

/** Let the user wire Claude Code / Codex (and any stdio MCP client) to the bridge. */
async function copyMcpSetup(shim: string): Promise<void> {
  const picked = await vscode.window.showQuickPick(mcpSetupOptions(shim), {
    title: "Copy MCP setup for…",
  });
  if (!picked) {
    return;
  }
  await vscode.env.clipboard.writeText(picked.detail);
  void vscode.window.showInformationMessage(
    `Copied the ${picked.label} MCP setup. Run it in a terminal (or paste it into the config).`,
  );
}
