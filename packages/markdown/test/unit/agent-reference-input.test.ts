import test from "node:test";
import assert from "node:assert/strict";
import { parseAgentReference } from "../../src/shared/agent-reference-input";

test("agent references retain ranges, spaces, Unicode and literal filename punctuation", () => {
  assert.deepEqual(parseAgentReference("@notes/空 格 #draft.md#12-18"), {
    location: "notes/空 格 #draft.md",
    isUri: false,
    startLine: 12,
    endLine: 18,
  });
  assert.deepEqual(parseAgentReference("'@notes\\a.md#2'"), {
    location: "notes/a.md",
    isUri: false,
    startLine: 2,
    endLine: 2,
  });
  for (const quoted of ['"@a.md#1"', "`@a.md#1`", "“@a.md#1”", "‘@a.md#1’"]) {
    assert.equal(parseAgentReference(quoted).location, "a.md");
  }
});

test("full URI references keep authority, escaping and query text", () => {
  const location =
    "vscode-remote://ssh-remote+dev/notes/a%20b.md?revision=full";
  assert.deepEqual(parseAgentReference(`@${location}#30-32`), {
    location,
    isUri: true,
    startLine: 30,
    endLine: 32,
  });
  assert.equal(
    parseAgentReference("file:///C:/notes/a.md#3").location,
    "file:///C:/notes/a.md",
  );
});

test("an absolute path, as Copy Link for Agent writes a note outside the workspace, reads as its file URI", () => {
  assert.deepEqual(parseAgentReference("@/notes/赠礼/a（1）.md#12-18"), {
    location: "file:///notes/%E8%B5%A0%E7%A4%BC/a%EF%BC%881%EF%BC%89.md",
    isUri: true,
    startLine: 12,
    endLine: 18,
  });
});

test("malformed references and workspace escapes are rejected", () => {
  for (const value of [
    "",
    "@a.md",
    "@a.md#0",
    "@a.md#2-1",
    "@a.md#1-2-3",
    "@a.md#1.5",
    "@a.md#9007199254740992",
    "@../private.md#1",
    "@notes/../a.md#1",
    "@\\outside.md#1",
    "@a.md\n#1",
    "@a.md#1\n> passage",
    '"@a.md#1',
    "@file:///a b.md#1",
    "C:/notes/a.md#3",
    "C:\\notes\\a.md#3",
    "file:///n/a.md#x#3",
    `@${"a".repeat(32769)}.md#1`,
  ]) {
    assert.throws(() => parseAgentReference(value), value);
  }
});

test("an absolute path with spaces, as Copy Link for Agent writes it, reads back as its file URI", () => {
  assert.deepEqual(
    parseAgentReference('@"/vault/projects/AI 活动/BCS 41350 修复.md"#20-24'),
    {
      location:
        "file:///vault/projects/AI%20%E6%B4%BB%E5%8A%A8/BCS%2041350%20%E4%BF%AE%E5%A4%8D.md",
      isUri: true,
      startLine: 20,
      endLine: 24,
    },
  );
});

test("a quoted workspace path reads back without its quotes; the bare form still reads", () => {
  for (const reference of [
    '@"notes/My Notes/a.md"#3-4',
    "@notes/My Notes/a.md#3-4",
  ]) {
    assert.deepEqual(parseAgentReference(reference), {
      location: "notes/My Notes/a.md",
      isUri: false,
      startLine: 3,
      endLine: 4,
    });
  }
});
