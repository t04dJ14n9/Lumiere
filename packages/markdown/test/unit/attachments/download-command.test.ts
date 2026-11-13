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

/** What a URL answers: its Content-Type (null for none) and body. */
type Serve = (url: string) => { type: string | null; bytes?: number[] };

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];

async function run(
  t: test.TestContext,
  answer: string | undefined,
  settings: Record<string, unknown> = {},
  options: { note?: string; applies?: boolean; serve?: Serve } = {},
): Promise<Run> {
  const note = options.note ?? NOTE;
  const { vaults } = memoryVaults({ "Note.md": note, "cat.png": "" });
  const result: Run = { asked: [], told: [], written: [], text: note };
  const document = { uri: uriOf("Note.md"), getText: () => result.text };
  const original = globalThis.fetch;
  const serve: Serve =
    options.serve ??
    ((url) => ({ type: url.endsWith(".png") ? "image/png" : "text/html" }));
  globalThis.fetch = (async (url: string) => {
    const { type, bytes = [1, 2] } = serve(url);
    return {
      ok: true,
      headers: {
        get: (name: string) => (name === "content-type" ? type : null),
      },
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
    };
  }) as unknown as typeof fetch;
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
        isSymbolicLink: async () => false,
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
    "Downloaded 2 attachments. 1 skipped, not an image: https://ex.com/page.html.",
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

test("a percent-encoded SVG data URI is saved as an svg file", async (t) => {
  const note =
    "![logo](data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E)";
  const result = await run(t, "Download", {}, { note });
  assert.deepEqual(result.written, [uriOf("Image.svg")]);
  assert.equal(result.text, "![[Image.svg|logo]]");
  assert.deepEqual(result.told, ["Downloaded 1 attachment."]);
});

test("when the note cannot be edited, the files are kept and the reader is told it is unchanged", async (t) => {
  const result = await run(t, "Download", {}, { applies: false });
  assert.deepEqual(result.written, [uriOf("cat 1.png"), uriOf("Image.gif")]);
  assert.equal(result.text, NOTE);
  assert.deepEqual(result.told, [
    "Saved 2 attachments in the vault, but the note was not changed. 1 skipped, not an image: https://ex.com/page.html.",
  ]);
});

test("a URL serving no image is skipped and its link stays, whatever its name", async (t) => {
  const note = [
    "![login](https://ex.com/cat.png) ![api](https://ex.com/data.json)",
    "![raw](https://ex.com/raw) ![blob](https://ex.com/blob)",
  ].join("\n");
  const serve: Serve = (url) => {
    if (url.endsWith("/raw")) {
      return { type: "application/octet-stream", bytes: PNG };
    }
    if (url.endsWith("/blob")) {
      return { type: null, bytes: [1, 2, 3] };
    }
    return { type: url.endsWith(".json") ? "application/json" : "text/html" };
  };
  const result = await run(t, "Download", {}, { note, serve });
  assert.deepEqual(result.written, [uriOf("Image.png")]);
  assert.equal(
    result.text,
    [
      "![login](https://ex.com/cat.png) ![api](https://ex.com/data.json)",
      "![[Image.png|raw]] ![blob](https://ex.com/blob)",
    ].join("\n"),
  );
  assert.deepEqual(result.told, [
    "Downloaded 1 attachment. 3 skipped, not an image: https://ex.com/cat.png, https://ex.com/data.json, https://ex.com/blob.",
  ]);
});

test("the summary names a few skipped URLs and counts the rest", async (t) => {
  const note = [1, 2, 3, 4, 5]
    .map((index) => `![](https://ex.com/p${index}.html)`)
    .join(" ");
  const result = await run(t, "Download", {}, { note });
  assert.deepEqual(result.written, []);
  assert.deepEqual(result.told, [
    "Downloaded 0 attachments. 5 skipped, not an image: https://ex.com/p1.html, https://ex.com/p2.html, https://ex.com/p3.html and 2 more.",
  ]);
});
