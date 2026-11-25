import { provideHostServices } from "../../../src/shared/host";
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import { agentBridgeHost } from "../../../src/plugins/agentBridge/host";
import { protocol } from "../../../src/plugins/agentBridge/protocol";
import {
  agentReferenceText,
  workspaceRelativePath,
} from "../../../src/plugins/agentBridge/reference";
import { fixture } from "./fixture";

test("selection capture returns frozen original CRLF offsets and excludes a trailing column-zero line", async () => {
  const f = fixture();
  const selection = await f.selections.capture("panel");
  assert.ok(selection);
  assert.ok(Object.isFrozen(selection));
  assert.deepEqual(
    [
      selection.from,
      selection.to,
      selection.startLine,
      selection.endLine,
      selection.text,
    ],
    [0, 10, 1, 2, "one\ntwo\n"],
  );
  assert.equal(f.agent.reference(selection).text, "@Note.md#1-2");
  assert.throws(() => f.agent.reference({ ...selection }), {
    code: "InvalidArgument",
  });
  f.state.version++;
  assert.throws(() => f.agent.reference(selection), { code: "StaleSelection" });
  await f.pair.dispose();
});
test("selection capture rejects concurrent source changes and invented selected text", async () => {
  const f = fixture();
  f.beforeCapture(() => {
    f.state.version++;
  });
  await assert.rejects(f.selections.capture("panel"), {
    code: "StaleSelection",
  });
  f.beforeCapture(() => {});
  f.state.forged = true;
  await assert.rejects(f.selections.capture("panel"), {
    code: "StaleSelection",
  });
  f.state.closed = true;
  await assert.rejects(f.selections.capture("panel"), {
    code: "EditorNotFound",
  });
  await f.pair.dispose();
});
test("references use the workspace-relative path in one local folder, else the full URI", () => {
  assert.equal(
    workspaceRelativePath("file:///vault/folder/A%20B.md", ["file:///vault"]),
    "folder/A B.md",
  );
  assert.equal(
    agentReferenceText(
      "file:///vault/folder/A%20B.md",
      ["file:///vault"],
      2,
      2,
    ),
    '@"folder/A B.md"#2',
  );
  assert.equal(
    agentReferenceText("file:///vault2/A.md", ["file:///vault"], 1, 3),
    "@/vault2/A.md#1-3",
  );
  assert.equal(
    agentReferenceText(
      "file:///vault/A.md",
      ["file:///vault", "file:///other"],
      4,
      4,
    ),
    "@/vault/A.md#4",
  );
  assert.equal(
    agentReferenceText(
      "vscode-remote://ssh-remote+host/A.md",
      ["vscode-remote://ssh-remote+host/"],
      1,
      1,
    ),
    "@vscode-remote://ssh-remote+host/A.md#1",
  );
  // The ported LLM Wiki formatter rejects paths that escape the workspace.
  assert.throws(() =>
    agentReferenceText("file:///vault/a%0Ab.md", ["file:///vault"], 1, 2),
  );
  assert.throws(() =>
    agentReferenceText("file:///vault/A.md", ["file:///vault"], 3, 2),
  );
});
test("Copy Link for Agent on an unsaved note: cancel, copy text only, or save and recapture", async () => {
  const f = fixture();
  f.state.dirty = true;
  f.state.choice = undefined;
  const commands: unknown[] = [];
  const execute = f.host.hostCommands.execute;
  f.host.hostCommands.execute = async (id, ...args) => {
    commands.push([id, ...args]);
    return execute(id, ...args);
  };
  let saved = false;
  f.beforeSave(() => {
    saved = true;
  });
  assert.equal(await f.agent.copy("panel"), false);
  assert.equal(f.state.dirty, true);
  assert.equal(saved, false);
  assert.deepEqual(f.copied, []);
  assert.deepEqual(commands, []);
  assert.deepEqual(f.asked, [["Save and Copy", "Copy Text Only"]]);
  f.state.choice = "Copy Text Only";
  assert.equal(await f.agent.copy("panel"), true);
  assert.equal(f.copied.pop(), "one\ntwo\n");
  f.state.choice = "Save and Copy";
  f.beforeSave(() => {
    f.state.from = 4;
    f.state.to = 7;
  });
  assert.equal(await f.agent.copy("panel"), true);
  assert.equal(f.copied.pop(), "@Note.md#2\n\n> two\n");
  assert.equal(f.state.dirty, false);
  await f.pair.dispose();
});
test("Copy Link for Agent host removes disabled handlers and restores them on enable", async () => {
  const f = fixture();
  const root = createRoot();
  root.provide("editors", f.editors);
  root.provide("selections", f.selections);
  provideHostServices(root, f.host);
  root.plugin(agentBridgeHost);
  await root.settled();
  assert.equal(await f.pair.client.call(protocol, "copy", {}), true);
  f.state.enabled = false;
  f.changeConfig();
  await assert.rejects(f.pair.client.call(protocol, "copy", {}), {
    code: "PluginDisabled",
  });
  f.state.enabled = true;
  f.changeConfig();
  assert.equal(await f.pair.client.call(protocol, "copy", {}), true);
  await root.dispose();
  await assert.rejects(f.pair.client.call(protocol, "copy", {}), {
    code: "PluginDisabled",
  });
  await f.pair.dispose();
});
test("Copy Link for Agent stops repeating the Codex attachment once the plugin stops", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  const commands = ["chatgpt.openSidebar", "chatgpt.addFileToThread"];
  const ran: string[] = [];
  f.host.agentHost.environment = async () => ({
    target: "codex",
    agentExtensions: new Set(),
    commands: new Set(commands),
    hasChatParticipant: false,
    chatDisabled: false,
  });
  f.host.hostCommands.execute = async (id) => {
    ran.push(id);
    return undefined;
  };
  assert.equal(await f.agent.copy("panel"), true);
  assert.deepEqual(ran, commands);
  f.agent.dispose();
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(5000);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(ran, commands, "no attachment after the plugin stopped");
  await f.pair.dispose();
});
