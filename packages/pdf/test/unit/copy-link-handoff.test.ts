import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
// First: everything below imports 'vscode', which this points at the fake.
import "./support/install-fake-vscode";
import * as vscode from "./support/fake-vscode";
import { AGENT_COMMANDS } from "../../src/shared/agent-target";
import { pageLinkText } from "../../src/shared/agent-text";
import { AgentHandoff } from "../../src/extension/plugins/agentBridge/handoff";
import type { PdfPanel } from "../../src/extension/plugins/pdf/panel";

let clipboard: string[];
let warnings: string[];
let info: string[];
let executed: string[];
const original = {
  writeText: vscode.env.clipboard.writeText,
  showWarningMessage: vscode.window.showWarningMessage,
  showInformationMessage: vscode.window.showInformationMessage,
  asRelativePath: vscode.workspace.asRelativePath,
  executeCommand: vscode.commands.executeCommand,
  getCommands: vscode.commands.getCommands,
};

beforeEach(() => {
  clipboard = [];
  warnings = [];
  info = [];
  executed = [];
  vscode.env.clipboard.writeText = async (text: string) => {
    clipboard.push(text);
    return undefined;
  };
  vscode.window.showWarningMessage = async (message: string) => {
    warnings.push(message);
    return undefined;
  };
  vscode.window.showInformationMessage = async (message: string) => {
    info.push(message);
    return undefined;
  };
  vscode.workspace.asRelativePath = () => "papers/attention.pdf";
  vscode.commands.getCommands = async () => [
    AGENT_COMMANDS.chatOpen,
    AGENT_COMMANDS.claudeCodeOpen,
    AGENT_COMMANDS.codexOpen,
    AGENT_COMMANDS.codexAddFile,
  ];
  vscode.commands.executeCommand = async (id: string, ..._args: unknown[]) => {
    executed.push(id);
    if (id === "setContext") {
      return undefined;
    }
    return undefined;
  };
  vscode.configuration.set("lumiere.pdf.copyLinkForAgent.target", "cursor");
  vscode.env.appName = "Cursor";
});

afterEach(() => {
  vscode.env.clipboard.writeText = original.writeText;
  vscode.window.showWarningMessage = original.showWarningMessage;
  vscode.window.showInformationMessage = original.showInformationMessage;
  vscode.workspace.asRelativePath = original.asRelativePath;
  vscode.commands.executeCommand = original.executeCommand;
  vscode.commands.getCommands = original.getCommands;
  vscode.configuration.delete("lumiere.pdf.copyLinkForAgent.target");
  vscode.env.appName = "Visual Studio Code";
});

test("copyLinkForAgent with no selection copies pageLinkText for readingPage", async () => {
  const panel = {
    uri: vscode.Uri.file("/work/papers/attention.pdf"),
    selectionSnapshot: () => undefined,
    view: { readingPage: 4, page: 5 },
  } as unknown as PdfPanel;

  const handoff = new AgentHandoff(() => undefined);
  assert.equal(await handoff.copyLinkForAgent(panel), true);

  assert.deepEqual(clipboard, [
    pageLinkText({ path: "papers/attention.pdf" }, 4),
  ]);
  assert.deepEqual(
    executed.filter((id) =>
      Object.values(AGENT_COMMANDS).includes(
        id as (typeof AGENT_COMMANDS)[keyof typeof AGENT_COMMANDS],
      ),
    ),
    [],
    "openAgentChat must not run",
  );
  assert.deepEqual(info, [], "no paste / chat hint");
  assert.deepEqual(warnings, []);
});

test("copyLinkForAgent with no page warns and copies nothing", async () => {
  const panel = {
    uri: vscode.Uri.file("/work/papers/attention.pdf"),
    selectionSnapshot: () => undefined,
    view: undefined,
  } as unknown as PdfPanel;

  const handoff = new AgentHandoff(() => undefined);
  assert.equal(await handoff.copyLinkForAgent(panel), false);
  assert.deepEqual(clipboard, []);
  assert.deepEqual(warnings, ["Open a PDF page to copy a link."]);
  assert.deepEqual(
    executed.filter((id) =>
      Object.values(AGENT_COMMANDS).includes(
        id as (typeof AGENT_COMMANDS)[keyof typeof AGENT_COMMANDS],
      ),
    ),
    [],
  );
});
