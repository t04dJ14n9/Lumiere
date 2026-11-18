import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, mock, test } from "node:test";
// First: chat.ts imports 'vscode', which this points at the fake.
import "./support/install-fake-vscode";
import * as fake from "./support/fake-vscode";
import { openAgentChat } from "../../src/extension/plugins/agentBridge/chat";
import { AGENT_COMMANDS } from "../../src/shared/agent-target";

let temp: string;
const attached: string[] = [];
const realTmpdir = process.env.TMPDIR;

before(async () => {
  // A temp folder of its own, so another user's folder can be played here.
  temp = await mkdtemp(path.join(os.tmpdir(), "lumiere-codex-"));
  process.env.TMPDIR = temp;
  fake.configuration.set("lumiere.pdf.copyLinkForAgent.target", "codex");
  Object.assign(fake.commands, {
    getCommands: async () => [
      AGENT_COMMANDS.codexOpen,
      AGENT_COMMANDS.codexAddFile,
    ],
    executeCommand: async (id: string, uri?: fake.Uri) => {
      if (id === AGENT_COMMANDS.codexAddFile && uri) {
        attached.push(uri.fsPath);
      }
    },
  });
  // The attach retries wait seconds; their timers never fire here.
  mock.timers.enable({ apis: ["setTimeout"] });
});

after(async () => {
  mock.timers.reset();
  process.env.TMPDIR = realTmpdir;
  await rm(temp, { recursive: true, force: true });
});

test("the selection for Codex goes to a private folder, never through another user's link", async () => {
  // Another user made the old fixed folder first, as a link to their own.
  const theirs = path.join(temp, "theirs");
  await mkdir(theirs);
  await symlink(theirs, path.join(temp, "agent-pdf-viewer"));

  const target = await openAgentChat(
    "> quoted text",
    undefined,
    fake.Uri.file("/papers/paper.pdf") as never,
  );
  assert.equal(target, "codex");
  assert.deepEqual(await readdir(theirs), []);
  const file = attached[0]!;
  assert.equal(await readFile(file, "utf8"), "> quoted text\n");
  const folder = await lstat(path.dirname(file));
  assert.ok(folder.isDirectory() && !folder.isSymbolicLink());
  assert.equal(folder.mode & 0o777, 0o700);
  assert.equal(path.dirname(path.dirname(file)), temp);
});
