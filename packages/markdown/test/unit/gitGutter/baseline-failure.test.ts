import test from "node:test";
import assert from "node:assert/strict";
import { baselineFailure } from "../../../src/shared/git";

test("F22: git saying the note is not there is untracked", () => {
  for (const stderr of [
    "fatal: path 'u.md' exists on disk, but not in 'HEAD'",
    "fatal: path 'u.md' exists on disk, but not in the index",
    "fatal: path 'gone.md' does not exist in 'HEAD'",
    "fatal: path 'gone.md' does not exist (neither on disk nor in the index)",
    "fatal: path 'n.md' is in the index, but not at stage 0",
    "fatal: Not a valid object name HEAD:n.md",
  ]) {
    // The Node host's runner puts git's stderr in the message.
    assert.equal(baselineFailure(new Error(stderr)), "untracked", stderr);
    // VS Code's git extension keeps it apart.
    assert.equal(
      baselineFailure(
        Object.assign(new Error("Failed to execute git"), { stderr }),
      ),
      "untracked",
      stderr,
    );
  }
});

test("F22: any other failure to read the baseline is unavailable", () => {
  for (const error of [
    new Error("git timed out after 5000ms"),
    new Error("fatal: not a git repository (or any of the parent directories)"),
    new Error("error: inflate: data stream error (incorrect header check)"),
    Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }),
    Object.assign(new Error("Failed to execute git"), {
      stderr: "fatal: unable to read 5d1c0bd1",
    }),
    "a string",
    undefined,
  ]) {
    assert.equal(baselineFailure(error), "unavailable", String(error));
  }
});
