import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "@workshop/core";
import { provideHostServices } from "../../../src/shared/host";
import type { TextEdit } from "../../../src/shared/host";
import { contributionId } from "../../../src/shared/setting-schema";
import { scratchHost } from "../../../src/plugins/scratch/host";
import type { EditorPanel } from "../../../src/plugins/editor/api";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";

const ROOT = "file:///project";
const NOTE = `${ROOT}/scratch/Draft.md`;
const CONCEPT = {
  item: {
    label: "Concept",
    description: "concepts",
    value: { type: "Concept", logical: "concepts" },
  },
  query: "",
};

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("promoting uses the note text as it is after the picker closes", async (t) => {
  let currentText = "---\ntitle: Draft\n---\nInitial body\n";
  const document = fakeDocument({ uri: NOTE, getText: () => currentText });
  const written = new Map<string, string>();
  const applied: { edits: readonly TextEdit[] }[] = [];
  const pickOpened = gate<void>();
  const pickAnswer = gate<typeof CONCEPT>();
  const informed = gate<string>();
  const commands = new Map<string, () => unknown>();
  const host = fakeHost({
    hostCommands: {
      register: (id, run) => {
        commands.set(id, run as () => unknown);
        return () => {
          commands.delete(id);
        };
      },
    },
    hostDocuments: {
      apply: async (_document, edits) => {
        applied.push({ edits });
        return true;
      },
    },
    dialogs: {
      pick: ((): Promise<typeof CONCEPT> => {
        pickOpened.resolve();
        return pickAnswer.promise;
      }) as never,
      inform: (message) => informed.resolve(message),
      error: (message) => informed.resolve(`error: ${message}`),
    },
    workspace: {
      folders: () => [ROOT],
      files: {
        list: async () => undefined,
        mkdir: async () => {},
        isSymbolicLink: async () => false,
        writeText: async (uri: string, text: string) => {
          written.set(uri, text);
        },
      } as never,
    },
  });
  const root = createRoot();
  provideHostServices(root, host);
  root.provide("editors", {
    all: () => [],
    active: () => ({ document }) as unknown as EditorPanel,
    capture: async () => {
      throw new Error("unused");
    },
    restore: async () => {},
  });
  root.plugin(scratchHost);
  await root.settled();
  t.after(() => root.dispose());

  commands.get(contributionId("scratch.promote"))!();
  await pickOpened.promise;
  // The picker is open: the user keeps typing in the note.
  currentText = `${currentText}Written while the picker was open\n`;
  pickAnswer.resolve(CONCEPT);

  assert.match(await informed.promise, /^Promoted to knowledge\/concepts\//);
  const page = [...written.values()][0] ?? "";
  assert.match(page, /Initial body/);
  assert.match(page, /Written while the picker was open/);
  assert.equal(applied.length, 1);
  assert.match(
    applied[0]?.edits[0]?.insert ?? "",
    /Promoted to \[Draft\]\(\.\.\/knowledge\/concepts\/draft\.md\)\./,
  );
});
