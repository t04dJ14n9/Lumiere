import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { MARKDOWN_EDITOR } from "@workshop/markdown/portable";
import { NoteDocuments, noteFiles } from "../../src/host/documents";
import { createNodePlatform } from "../../src/host/node-platform";
import type { PageSocket } from "../../src/host/panel";
import { PanelHub } from "../../src/host/panels";
import { createClipboard, createDialogs } from "../../src/host/ui-services";

const urls = () => ({
  cspSource: "'self'",
  asset: (relative: string) => `/lumiere/m/${relative}`,
  resource: (uri: string) => `/lumiere/file?uri=${uri}`,
});

/** A page's socket that records what the host sent it. */
function recordingSocket() {
  const sent: unknown[] = [];
  const socket: PageSocket = {
    send: (text) => sent.push(JSON.parse(text)),
    onMessage: () => () => {},
    onClose: () => () => {},
    close: () => {},
  };
  return { socket, sent };
}

const toasts = (sent: readonly unknown[]) =>
  sent.filter(
    (frame) => (frame as { data?: { type?: string } }).data?.type === "toast",
  );

async function setup(t: test.TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-ui-"));
  await writeFile(path.join(dir, "Note.md"), "hello");
  const uri = pathToFileURL(path.join(dir, "Note.md")).toString();
  const files = noteFiles(createNodePlatform({ data: tmpdir(), workers: "" }));
  const documents = new NoteDocuments(
    {
      ...files,
      save: async () => {
        throw new Error("The disk is full");
      },
    },
    60_000,
  );
  const hub = new PanelHub(documents);
  hub.register(MARKDOWN_EDITOR, (shell) => shell.setHTML("<html></html>"));
  const logged: string[] = [];
  const dialogs = createDialogs(hub, (message) => logged.push(message));
  documents.onSaveFailed((_uri, error) =>
    dialogs.error((error as Error).message),
  );
  t.after(async () => {
    hub.dispose();
    await documents.dispose().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });
  return { uri, documents, hub, dialogs, logged };
}

test("a save that fails as the last page closes is shown on the next page that opens", async (t) => {
  const { uri, documents, hub, logged } = await setup(t);
  const { id } = await hub.open({ uri, urls });
  const note = await documents.open(uri);
  await documents.apply(note, [{ from: 0, to: 5, insert: "typed" }]);

  hub.get(id)!.dispose();
  for (let i = 0; i < 100 && logged.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(logged, ["The disk is full"]);
  assert.equal(hub.all().length, 0);

  const next = await hub.open({ uri, urls });
  const page = recordingSocket();
  hub.attach(next.id, page.socket);
  assert.deepEqual(toasts(page.sent), [
    {
      ch: "ui",
      data: { type: "toast", kind: "error", message: "The disk is full" },
    },
  ]);
  assert.equal(documents.text(uri), "typed");
});

test("an error shown on an open page is not shown again on the next one", async (t) => {
  const { uri, hub, dialogs } = await setup(t);
  const first = await hub.open({ uri, urls });
  const firstPage = recordingSocket();
  hub.attach(first.id, firstPage.socket);
  dialogs.error("Seen");
  assert.equal(toasts(firstPage.sent).length, 1);

  const second = await hub.open({ uri, urls });
  const secondPage = recordingSocket();
  hub.attach(second.id, secondPage.socket);
  assert.deepEqual(toasts(secondPage.sent), []);
});

/** A page's socket the test can answer through. */
function answeringSocket() {
  const sent: {
    ch: string;
    data: { type: string; id: number; items?: unknown[] };
  }[] = [];
  let receive: (text: string) => void = () => {};
  const socket: PageSocket = {
    send: (text) => sent.push(JSON.parse(text)),
    onMessage: (listener) => {
      receive = listener;
      return () => {};
    },
    onClose: () => () => {},
    close: () => {},
  };
  const answer = (id: number, value: unknown) =>
    receive(JSON.stringify({ ch: "ui", data: { type: "answer", id, value } }));
  return { socket, sent, answer };
}

const choices = [
  {
    label: "a.png",
    description: "ex.com",
    detail: "https://ex.com/a.png",
    value: "A",
  },
  { label: "b.png", value: "B" },
  { label: "c.png", value: "C" },
];

async function askMany(t: test.TestContext, reply: (id: number) => unknown) {
  const { uri, hub, dialogs } = await setup(t);
  const { id } = await hub.open({ uri, urls });
  const page = answeringSocket();
  hub.attach(id, page.socket);
  const result = dialogs.pickMany({ placeholder: "Download?", items: choices });
  const request = page.sent.find((frame) => frame.data.type === "pickMany")!;
  page.answer(request.data.id, reply(request.data.id));
  return { request, result: await result };
}

test("a multi-select pick shows the rows and resolves the ticked values in row order", async (t) => {
  const { request, result } = await askMany(t, () => [2, 0]);
  assert.deepEqual(request.data, {
    type: "pickMany",
    id: request.data.id,
    placeholder: "Download?",
    items: [
      { label: "a.png", description: "ex.com", detail: "https://ex.com/a.png" },
      { label: "b.png" },
      { label: "c.png" },
    ],
  });
  assert.deepEqual(result, ["A", "C"]);
});

test("a multi-select pick ignores rows the page invented and repeats", async (t) => {
  const { result } = await askMany(t, () => [1, 1, 9, 0]);
  assert.deepEqual(result, ["A", "B"]);
});

test("a multi-select pick is empty when nothing is ticked and none when dismissed", async (t) => {
  assert.deepEqual((await askMany(t, () => [])).result, []);
  assert.equal((await askMany(t, () => null)).result, undefined);
  assert.equal((await askMany(t, () => "A")).result, undefined);
});

test("a multi-select pick with no page open is dismissed", async (t) => {
  const { dialogs } = await setup(t);
  assert.equal(
    await dialogs.pickMany({ placeholder: "x", items: choices }),
    undefined,
  );
});

/** A page's socket that answers clipboard reads with `clipboard`. */
function clipboardPage(clipboard: string | null) {
  const sent: unknown[] = [];
  let receive: (text: string) => void = () => {};
  const socket: PageSocket = {
    send: (text) => {
      const frame = JSON.parse(text) as {
        data?: { type?: string; id?: number };
      };
      sent.push(frame);
      if (frame.data?.type === "readClipboard") {
        const answer = {
          type: "clipboard",
          id: frame.data.id,
          text: clipboard,
        };
        queueMicrotask(() =>
          receive(JSON.stringify({ ch: "ui", data: answer })),
        );
      }
    },
    onMessage: (listener) => {
      receive = listener;
      return () => {};
    },
    onClose: () => () => {},
    close: () => {},
  };
  return { socket, sent };
}

test("a paste reads the real clipboard through the page, not only what Lumière copied", async (t) => {
  const { uri, hub } = await setup(t);
  const { id } = await hub.open({ uri, urls });
  hub.attach(id, clipboardPage("| a | b |\n| - | - |").socket);
  const clipboard = createClipboard(hub);
  await clipboard.write("copied by Lumière");
  assert.equal(await clipboard.read(), "| a | b |\n| - | - |");
});

test("a page the browser refuses gives what Lumière last copied", async (t) => {
  const { uri, hub } = await setup(t);
  const { id } = await hub.open({ uri, urls });
  hub.attach(id, clipboardPage(null).socket);
  const clipboard = createClipboard(hub);
  await clipboard.write("copied by Lumière");
  assert.equal(await clipboard.read(), "copied by Lumière");
});
