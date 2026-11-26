import assert from "node:assert/strict";
import test from "node:test";
import {
  notesToReopen,
  type OpenTab,
} from "../../../src/host/first-activation-policy";

function tab(
  uri: string,
  overrides: Partial<OpenTab<string>> = {},
): OpenTab<string> {
  return {
    tab: uri,
    uri,
    kind: "text",
    isDirty: false,
    isActive: false,
    ...overrides,
  };
}

const rules = {
  isNote: (uri: string) => uri.startsWith("file:") && uri.endsWith(".md"),
  isLumieres: (uri: string) => !uri.includes("kept-as-text"),
  isOptedOut: (uri: string) => uri.includes("opened-as-text"),
};

test("clean text tabs of notes Lumiere owns reopen, the active one last", () => {
  const chosen = notesToReopen(
    [
      tab("file:///vault/index.md", { isActive: true }),
      tab("file:///vault/a.md"),
      tab("file:///vault/b.md"),
    ],
    rules,
  );
  assert.deepEqual(
    chosen.map((item) => item.uri),
    ["file:///vault/a.md", "file:///vault/b.md", "file:///vault/index.md"],
  );
});

test("dirty, diff, other-editor, non-note, associated-away and opted-out tabs stay", () => {
  const chosen = notesToReopen(
    [
      tab("file:///vault/dirty.md", { isDirty: true }),
      tab("file:///vault/diff.md", { kind: "other" }),
      tab("file:///vault/lumiere.md", { kind: "workbench" }),
      tab("untitled:Untitled-1.md"),
      tab("git:/vault/a.md"),
      tab("file:///vault/script.ts"),
      tab("file:///vault/kept-as-text.md"),
      tab("file:///vault/opened-as-text.md"),
    ],
    rules,
  );
  assert.deepEqual(chosen, []);
});
