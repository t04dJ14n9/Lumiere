import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "@workshop/core";
import {
  registerMarkdownAssociation,
  useForMarkdownInWorkspace,
  withMarkdownLumiere,
} from "../../../src/plugins/editor/associations";
import { MARKDOWN_WORKSPACE_EDITOR_KEY } from "../../../src/shared/editor-provider";
import { provideHostServices } from "../../../src/shared/host";
import { fakeHost } from "../../support/vscode-fake";

test("Markdown patterns open in Lumiere directly; other associations stay", () => {
  assert.deepEqual(
    withMarkdownLumiere({ "*.pdf": "pdf.preview", "*.md": "default" }),
    {
      "*.pdf": "pdf.preview",
      "*.md": "lumiere.markdown.editor",
      "*.markdown": "lumiere.markdown.editor",
    },
  );
  for (const malformed of [undefined, null, [], "x", { "*.txt": 3 }]) {
    assert.deepEqual(withMarkdownLumiere(malformed), {
      "*.md": "lumiere.markdown.editor",
      "*.markdown": "lumiere.markdown.editor",
    });
  }
});

function harness(initial: unknown) {
  let value = initial;
  const writes: unknown[] = [];
  const messages: string[] = [];
  const errors: string[] = [];
  const storage = new Map<string, unknown>();
  const host = fakeHost({
    dialogs: {
      error: (message) => errors.push(message),
      inform: (message) => messages.push(message),
    },
    settings: {
      editorAssociations: {
        read: () => value,
        write: async (next) => {
          writes.push(next);
          value = next as typeof value;
        },
      },
    },
    storage: {
      get: <T>(key: string, fallback: T) =>
        (storage.has(key) ? storage.get(key) : fallback) as T,
      update: async (key, next) => {
        storage.set(key, next);
      },
    },
  });
  return { host, writes, messages, errors, storage };
}

test("the workspace command records Lumiere and opens Markdown in it directly", async () => {
  const h = harness({ "*.pdf": "pdf.preview" });
  await useForMarkdownInWorkspace(h.host);
  assert.deepEqual(h.writes, [
    {
      "*.pdf": "pdf.preview",
      "*.md": "lumiere.markdown.editor",
      "*.markdown": "lumiere.markdown.editor",
    },
  ]);
  assert.deepEqual([...h.storage.values()], [true]);
  await useForMarkdownInWorkspace(h.host);
  assert.equal(h.writes.length, 1, "an existing association is not rewritten");
  assert.equal(h.messages.length, 2);
  assert.match(h.messages[1]!, /already/);
  assert.deepEqual(h.errors, []);
});

test("without a workspace there is nothing to write", async () => {
  for (const h of [harness(undefined)]) {
    await useForMarkdownInWorkspace(h.host);
    assert.deepEqual(h.writes, []);
    assert.equal(h.errors.length, 1);
  }
});

function activate(t: test.TestContext, h: ReturnType<typeof harness>) {
  const root = createRoot();
  t.after(() => root.dispose());
  provideHostServices(root, h.host);
  root.plugin({
    name: "association-migration-test",
    inject: {
      required: ["hostCommands", "settings", "dialogs", "storage"],
    },
    apply: registerMarkdownAssociation,
  });
  return root.settled();
}

test("activation moves Lumiere's text-editor route to the direct association", async (t) => {
  const h = harness({
    "*.pdf": "pdf.preview",
    "*.md": "default",
    "*.markdown": "default",
  });
  h.storage.set(MARKDOWN_WORKSPACE_EDITOR_KEY, true);
  await activate(t, h);
  assert.deepEqual(h.writes, [
    {
      "*.pdf": "pdf.preview",
      "*.md": "lumiere.markdown.editor",
      "*.markdown": "lumiere.markdown.editor",
    },
  ]);
  assert.deepEqual(h.messages, [], "migration is silent");
});

test("activation migrates a workspace that only routes *.md through text", async (t) => {
  const h = harness({ "*.md": "default" });
  h.storage.set(MARKDOWN_WORKSPACE_EDITOR_KEY, true);
  await activate(t, h);
  assert.deepEqual(h.writes, [
    {
      "*.md": "lumiere.markdown.editor",
      "*.markdown": "lumiere.markdown.editor",
    },
  ]);
});

test("activation leaves a text association Lumiere did not write", async (t) => {
  for (const initial of [
    { "*.md": "default" },
    { "*.md": "lumiere.markdown.editor" },
  ]) {
    const h = harness(initial);
    await activate(t, h);
    assert.deepEqual(h.writes, [], JSON.stringify(initial));
  }
});
