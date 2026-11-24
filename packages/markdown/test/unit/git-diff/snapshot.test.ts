import test from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import {
  buildWorktreeSnapshot,
  offsetOfLine,
} from "../../../src/shared/git-diff/snapshot";
import { lineHunks } from "../../../src/shared/diff";
import { unifiedRows } from "../../../src/shared/git-diff/unified";
import { computeHunks } from "../../../src/plugins/gitGutter/hunks";

const caps = {
  canStage: true,
  canUnstage: false,
  canRevert: true,
};

test("INDEX→WORKTREE sets liveAnchor on every hunk", () => {
  const snap = buildWorktreeSnapshot({
    repository: "file:///repo",
    fileUri: "file:///repo/a.md",
    baseText: "a\n",
    targetText: "a\nb\n",
    base: { kind: "INDEX", fingerprint: "i1" },
    target: { kind: "WORKTREE" },
    worktreeBytes: {
      origin: "document",
      uri: "file:///repo/a.md",
      version: 3,
      isDirty: true,
    },
    liveDocumentUri: "file:///repo/a.md",
    mapLiveAnchor: ({ modifiedFrom, modifiedTo }) => ({
      uri: "file:///repo/a.md",
      from: modifiedFrom,
      to: modifiedTo,
    }),
    capabilitiesFor: () => caps,
    computedAt: 1,
  });
  assert.ok(snap.hunks.length >= 1);
  assert.ok(snap.hunks.every((hunk) => hunk.liveAnchor));
  assert.equal(snap.sourceState.worktreeBytes?.origin, "document");
  const rows = unifiedRows(snap.hunks[0]!.lines);
  assert.ok(rows.some((row) => row.kind === "add" && row.text === "b"));
  assert.equal(
    rows.some((row) => row.text.includes("<")),
    false,
  );
});

test("a context row that differs from the base is not part of a hunk, and rows past it are not paired with it", () => {
  const snap = buildWorktreeSnapshot({
    repository: "file:///repo",
    fileUri: "file:///repo/a.md",
    baseText: "p\nq\nr\nold",
    targetText: "p\nQ\nr\nnew",
    base: { kind: "INDEX", fingerprint: "i1" },
    target: { kind: "WORKTREE" },
    worktreeBytes: {
      origin: "document",
      uri: "file:///repo/a.md",
      version: 3,
      isDirty: true,
    },
    liveDocumentUri: "file:///repo/a.md",
    mapLiveAnchor: ({ modifiedFrom, modifiedTo }) => ({
      uri: "file:///repo/a.md",
      from: modifiedFrom,
      to: modifiedTo,
    }),
    capabilitiesFor: () => caps,
    computedAt: 1,
  });
  const last = snap.hunks[snap.hunks.length - 1]!;
  assert.deepEqual(
    last.lines
      .filter((line) => line.kind === "context")
      .map((line) => line.text),
    ["r"],
  );
});

test("live anchors use the same offsets as gutter hunks", () => {
  const base = "a\nold\nz\n";
  const now = "a\nnew\nz\nextra\n";
  const doc = Text.of(now.split("\n"));
  const snap = buildWorktreeSnapshot({
    repository: "file:///repo",
    fileUri: "file:///repo/a.md",
    baseText: base,
    targetText: now,
    base: { kind: "HEAD", oid: "abc" },
    target: { kind: "WORKTREE" },
    worktreeBytes: {
      origin: "document",
      uri: "file:///repo/a.md",
      version: 1,
      isDirty: true,
    },
    mapLiveAnchor: ({ modifiedFrom, modifiedTo }) => ({
      uri: "file:///repo/a.md",
      from: modifiedFrom,
      to: modifiedTo,
    }),
    capabilitiesFor: () => caps,
    computedAt: 1,
  });
  const docs = computeHunks(base, doc);
  assert.equal(snap.hunks.length, docs.length);
  for (let i = 0; i < docs.length; i++) {
    assert.equal(snap.hunks[i]!.liveAnchor?.from, docs[i]!.from);
  }
});

test("HEAD→INDEX omits liveAnchor by default", () => {
  const snap = buildWorktreeSnapshot({
    repository: "file:///repo",
    fileUri: "file:///repo/a.md",
    baseText: "a\n",
    targetText: "a\nb\n",
    base: { kind: "HEAD", oid: "abc" },
    target: { kind: "INDEX", fingerprint: "i1" },
    capabilitiesFor: () => ({
      canStage: false,
      canUnstage: true,
      canRevert: false,
    }),
    computedAt: 2,
  });
  assert.ok(snap.hunks.every((hunk) => hunk.liveAnchor === undefined));
  assert.equal(snap.liveDocumentUri, undefined);
  assert.equal(snap.sourceState.worktreeBytes, undefined);
});

test("offsetOfLine counts lines by \\n, CRLF included, and clamps past the end", () => {
  assert.equal(offsetOfLine("a\r\nb\nc", 0), 0);
  assert.equal(offsetOfLine("a\r\nb\nc", -1), 0);
  assert.equal(offsetOfLine("a\r\nb\nc", 1), 3);
  assert.equal(offsetOfLine("a\r\nb\nc", 2), 5);
  assert.equal(offsetOfLine("a\r\nb\nc", 3), 6);
  assert.equal(offsetOfLine("a\r\nb\nc", 9), 6);
  assert.equal(offsetOfLine("", 1), 0);
});

test("every live anchor of a long note is where its line starts", () => {
  const base: string[] = [];
  for (let i = 0; i < 2000; i++) {
    base.push(`line ${i}`);
  }
  const now = base.map((line, i) => (i % 7 === 3 ? `${line} edited` : line));
  const target = `${now.join("\n")}\n`;
  const snap = buildWorktreeSnapshot({
    repository: "r",
    fileUri: "f",
    baseText: `${base.join("\n")}\n`,
    targetText: target,
    base: { kind: "HEAD", oid: "abc" },
    target: { kind: "WORKTREE" },
    mapLiveAnchor: ({ modifiedFrom, modifiedTo }) => ({
      uri: "f",
      from: modifiedFrom,
      to: modifiedTo,
    }),
    capabilitiesFor: () => caps,
  });
  assert.equal(snap.hunks.length, Math.ceil((2000 - 3) / 7));
  for (const hunk of snap.hunks) {
    const { startLine, endLine } = hunk.modifiedRange;
    assert.equal(hunk.liveAnchor?.from, offsetOfLine(target, startLine));
    assert.equal(hunk.liveAnchor?.to, offsetOfLine(target, endLine));
    assert.equal(
      target.slice(hunk.liveAnchor!.from).split("\n")[0],
      now[startLine],
    );
  }
});

test("a snapshot uses the caller's line diff instead of diffing again", () => {
  const baseText = "a\nb\nc\n";
  const targetText = "a\nB\nc\n";
  const diff = lineHunks(baseText, targetText);
  const input = {
    repository: "r",
    fileUri: "f",
    baseText,
    targetText,
    base: { kind: "HEAD", oid: "abc" } as const,
    target: { kind: "WORKTREE" } as const,
    capabilitiesFor: () => caps,
    generationId: "g",
  };
  assert.deepEqual(
    buildWorktreeSnapshot({ ...input, hunks: diff }),
    buildWorktreeSnapshot(input),
  );
  // What it was given is what it shows.
  assert.equal(buildWorktreeSnapshot({ ...input, hunks: [] }).hunks.length, 0);
});
