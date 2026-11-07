import test from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@workshop/core";
import { SourceCoordinates } from "../../../src/shared/document/coordinates";
import { downloadAttachments } from "../../../src/plugins/attachments/download-command";
import { ROOT, memoryVaults, uriOf } from "../views/fakes";

const NOTE = [
  "![A cat](https://ex.com/img/cat.png) and again ![](https://ex.com/img/cat.png)",
  "![page](https://ex.com/page.html) ![dot](data:image/gif;base64,R0lG)",
].join("\n");

interface Run {
  asked: string[];
  told: string[];
  written: string[];
  text: string;
}

async function run(
  t: test.TestContext,
  answer: string | undefined,
  settings: Record<string, unknown> = {},
  options: { note?: string; applies?: boolean } = {},
): Promise<Run> {
  const note = options.note ?? NOTE;
  const { vaults } = memoryVaults({ "Note.md": note, "cat.png": "" });
  const result: Run = { asked: [], told: [], written: [], text: note };
  const document = { uri: uriOf("Note.md"), getText: () => result.text };
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => ({
    ok: true,
    headers: {
      get: (name: string) =>
        name === "content-type"
          ? url.endsWith(".png")
            ? "image/png"
            : "text/html"
          : null,
    },
    arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
  })) as unknown as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const ctx = {
    editors: { active: () => ({ document }) },
    vaults,
    settings: {
      forNote: () => ({ features: { links: { config: settings } } }),
    },
    workspace: {
      files: {
        list: async (uri: string) =>
          uri.replace(/\/$/u, "") === ROOT ? ["Note.md", "cat.png"] : [],
        mkdir: async () => {},
        writeBytes: async (uri: string) => {
          result.written.push(uri);
        },
        writeText: async () => {},
      },
    },
    dialogs: {
      ask: async (message: string) => {
        result.asked.push(message);
        return answer;
      },
      inform: (message: string) => result.told.push(message),
      error: (message: string) => result.told.push(message),
    },
    hostDocuments: {
      apply: async (
        _document: unknown,
        edits: { from: number; to: number; insert: string }[],
      ) => {
        if (options.applies === false) {
          return false;
        }
        // Like the real host: offsets are the editor's (LF lines), and it
        // maps them onto the note's own line breaks.
        const coordinates = new SourceCoordinates(result.text);
        const source = edits.map((edit) => ({
          from: coordinates.toSource(edit.from),
          to: coordinates.toSource(edit.to),
          insert: edit.insert,
        }));
        for (const edit of source.sort((a, b) => b.from - a.from)) {
          result.text =
            result.text.slice(0, edit.from) +
            edit.insert +
            result.text.slice(edit.to);
        }
        return true;
      },
    },
  } as unknown as Context;
  await downloadAttachments(ctx);
  return result;
}

test("each web image is downloaded once, saved under its own name, and embedded with its alt", async (t) => {
  const result = await run(t, "Download", {
    attachmentFolder: "assets",
  });
  assert.deepEqual(result.asked, [
    "Download the 3 images this note shows from the web into the vault?",
  ]);
  assert.deepEqual(result.written, [
    uriOf("assets/cat.png"),
    uriOf("assets/Image.gif"),
  ]);
  assert.equal(
    result.text,
    [
      // Another cat.png is in the vault, so the embed spells the folder.
      "![[assets/cat.png|A cat]] and again ![[assets/cat.png]]",
      // A web page is not an image: it stays as it was.
      "![page](https://ex.com/page.html) ![[Image.gif|dot]]",
    ].join("\n"),
  );
  assert.deepEqual(result.told, [
    "Downloaded 2 attachments. 1 could not be downloaded.",
  ]);
});

test("Markdown links are written when wikilinks are off", async (t) => {
  const result = await run(t, "Download", { useWikilinks: false });
  assert.match(result.text, /^!\[A cat\]\(cat%201\.png\)/u);
});

test("declining downloads and changes nothing", async (t) => {
  const result = await run(t, undefined);
  assert.deepEqual(result.written, []);
  assert.equal(result.text, NOTE);
});

test("a note with CRLF line breaks is edited where its images are", async (t) => {
  const note = [
    "Line 1",
    "![A dog](https://ex.com/img/dog.png)",
    "Line 3",
    "![](https://ex.com/img/dog.png)",
    "",
  ].join("\r\n");
  const result = await run(t, "Download", {}, { note });
  assert.equal(
    result.text,
    ["Line 1", "![[dog.png|A dog]]", "Line 3", "![[dog.png]]", ""].join("\r\n"),
  );
});

test("a data URI that is not an image is not saved", async (t) => {
  const note = [
    "![page](data:text/html;base64,PGgxPng8L2gxPg==)",
    "![blank](data:;base64,R0lG) ![dot](data:image/gif;base64,R0lG)",
  ].join("\n");
  const result = await run(t, "Download", {}, { note });
  assert.deepEqual(result.written, [uriOf("Image.gif")]);
  assert.equal(
    result.text,
    [
      "![page](data:text/html;base64,PGgxPng8L2gxPg==)",
      "![blank](data:;base64,R0lG) ![[Image.gif|dot]]",
    ].join("\n"),
  );
  assert.deepEqual(result.told, [
    "Downloaded 1 attachment. 2 could not be downloaded.",
  ]);
});

test("when the note cannot be edited, the files are kept and the reader is told it is unchanged", async (t) => {
  const result = await run(t, "Download", {}, { applies: false });
  assert.deepEqual(result.written, [uriOf("cat 1.png"), uriOf("Image.gif")]);
  assert.equal(result.text, NOTE);
  assert.deepEqual(result.told, [
    "Saved 2 attachments in the vault, but the note was not changed. 1 could not be downloaded.",
  ]);
});
