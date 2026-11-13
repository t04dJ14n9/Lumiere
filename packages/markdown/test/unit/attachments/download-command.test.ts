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

interface Offered {
  label: string;
  description?: string;
  detail?: string;
  value: string;
}

interface Run {
  /** The pick list's placeholder each time it was shown. */
  asked: string[];
  /** The rows of the last pick list. */
  offered: Offered[];
  /** What was fetched, and whether redirects were left to the caller. */
  fetched: { url: string; redirect: string | undefined; hasSignal: boolean }[];
  told: string[];
  written: string[];
  text: string;
}

/** What a URL answers: its Content-Type (null for none) and body. */
type Serve = (url: string) => {
  type: string | null;
  bytes?: number[];
  /** A Content-Disposition header. */
  disposition?: string;
};

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];

async function run(
  t: test.TestContext,
  answer: string | undefined,
  settings: Record<string, unknown> = {},
  options: {
    note?: string;
    applies?: boolean;
    serve?: Serve;
    /** URLs the reader unticks in the list. */
    unticked?: string[];
  } = {},
): Promise<Run> {
  const note = options.note ?? NOTE;
  const { vaults } = memoryVaults({ "Note.md": note, "cat.png": "" });
  const result: Run = {
    asked: [],
    offered: [],
    fetched: [],
    told: [],
    written: [],
    text: note,
  };
  const document = { uri: uriOf("Note.md"), getText: () => result.text };
  const original = globalThis.fetch;
  const serve: Serve =
    options.serve ??
    ((url) => ({ type: url.endsWith(".png") ? "image/png" : "text/html" }));
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    result.fetched.push({
      url,
      redirect: init?.redirect,
      hasSignal: init?.signal instanceof AbortSignal,
    });
    const { type, bytes = [1, 2], disposition = null } = serve(url);
    return {
      ok: true,
      headers: {
        get: (name: string) =>
          name === "content-type"
            ? type
            : name === "content-disposition"
              ? disposition
              : null,
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
        // What is in the folder now, the files written to it included.
        list: async (uri: string) => {
          const folder = uri.replace(/\/$/u, "");
          const written = result.written
            .filter((file) => file.slice(0, file.lastIndexOf("/")) === folder)
            .map((file) => decodeURIComponent(file.slice(folder.length + 1)));
          return [
            ...(folder === ROOT ? ["Note.md", "cat.png"] : []),
            ...written,
          ];
        },
        mkdir: async () => {},
        writeBytes: async (uri: string) => {
          result.written.push(uri);
        },
        writeText: async () => {},
        isSymbolicLink: async () => false,
      },
    },
    dialogs: {
      // "Download" accepts the list as shown; anything else dismisses it.
      pickMany: async (pick: {
        placeholder: string;
        items: readonly Offered[];
      }) => {
        result.asked.push(pick.placeholder);
        result.offered = [...pick.items];
        return answer === "Download"
          ? pick.items
              .map((item) => item.value)
              .filter((url) => !options.unticked?.includes(url))
          : undefined;
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
    "Download 3 images into the vault? Untick any to leave out.",
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

test("a Content-Disposition name is the file's name, taken names get a number", async (t) => {
  const note = [
    "![a](https://ex.com/dl?id=1) ![b](https://ex.com/dl?id=2)",
    "![c](https://ex.com/dl?id=3) ![d](https://ex.com/photo.png?id=4)",
    "![e](https://ex.com/dl?id=5)",
  ].join("\n");
  const names: Record<string, string> = {
    "1": 'attachment; filename="Sunset.jpg"',
    "2": 'attachment; filename="sunset.JPG"',
    "3": "attachment; filename*=UTF-8''Caf%C3%A9%20au%20lait.png; filename=\"x.png\"",
    "4": 'inline; filename="../../Renamed.gif"',
    "5": 'attachment; filename="download"',
  };
  const serve: Serve = (url) => ({
    type: "image/png",
    disposition: names[url.slice(-1)]!,
  });
  const result = await run(t, "Download", {}, { note, serve });
  assert.deepEqual(result.written, [
    uriOf("Sunset.jpg"),
    uriOf("sunset 1.jpg"),
    uriOf("Café au lait.png"),
    uriOf("Renamed.gif"),
    uriOf("download.png"),
  ]);
  assert.equal(
    result.text,
    [
      "![[Sunset.jpg|a]] ![[sunset 1.jpg|b]]",
      "![[Café au lait.png|c]] ![[Renamed.gif|d]]",
      "![[download.png|e]]",
    ].join("\n"),
  );
});

test("an unusable Content-Disposition leaves the URL's own name", async (t) => {
  const note = "![a](https://ex.com/photo.png) ![b](https://ex.com/dl)";
  const serve: Serve = () => ({
    type: "image/png",
    disposition: 'attachment; filename=".."',
  });
  const result = await run(t, "Download", {}, { note, serve });
  assert.deepEqual(result.written, [uriOf("photo.png"), uriOf("Image.png")]);
});

const FRONT_NOTE = [
  "---",
  "title: Trip",
  "cover: https://ex.com/img/cover.png # hero",
  "site: https://ex.com/page",
  "photos:",
  "  - https://ex.com/img/dog.png",
  "  - 'https://ex.com/img/cat.png'",
  "  - https://ex.com/notes.pdf",
  "---",
  "![A dog](https://ex.com/img/dog.png)",
].join("\n");

test("image URLs in properties are downloaded once with the body's and rewritten in place", async (t) => {
  const result = await run(t, "Download", {}, { note: FRONT_NOTE });
  assert.deepEqual(result.asked, [
    "Download 3 images into the vault? Untick any to leave out.",
  ]);
  assert.deepEqual(result.written, [
    uriOf("cover.png"),
    uriOf("dog.png"),
    uriOf("cat 1.png"),
  ]);
  assert.equal(
    result.text,
    [
      "---",
      "title: Trip",
      'cover: "[[cover.png]]" # hero',
      "site: https://ex.com/page",
      "photos:",
      '  - "[[dog.png]]"',
      "  - '[[cat 1.png]]'",
      "  - https://ex.com/notes.pdf",
      "---",
      "![[dog.png|A dog]]",
    ].join("\n"),
  );
  assert.deepEqual(result.told, ["Downloaded 3 attachments."]);
});

test("a property URL that serves no image stays, and is named in the summary", async (t) => {
  const note = "---\ncover: https://ex.com/login.png\n---\nbody";
  const serve: Serve = () => ({ type: "text/html" });
  const result = await run(t, "Download", {}, { note, serve });
  assert.equal(result.text, note);
  assert.deepEqual(result.told, [
    "Downloaded 0 attachments. 1 skipped, not an image: https://ex.com/login.png.",
  ]);
});

test("a note with CRLF line breaks and properties is edited in both places", async (t) => {
  const note = [
    "---",
    "cover: https://ex.com/img/cover.png",
    "---",
    "![](https://ex.com/img/cover.png)",
    "",
  ].join("\r\n");
  const result = await run(t, "Download", {}, { note });
  assert.equal(
    result.text,
    ["---", 'cover: "[[cover.png]]"', "---", "![[cover.png]]", ""].join("\r\n"),
  );
});

test("a property link is a wikilink even when the note's links are Markdown", async (t) => {
  const note = "---\ncover: https://ex.com/img/cover.png\n---\n";
  const result = await run(t, "Download", { useWikilinks: false }, { note });
  assert.equal(result.text, '---\ncover: "[[cover.png]]"\n---\n');
});

test("a note with only property images offers them", async (t) => {
  const note = "---\ncover: https://ex.com/img/cover.png\n---\ntext";
  const result = await run(t, "Download", {}, { note });
  assert.deepEqual(result.asked, [
    "Download 1 image into the vault? Untick any to leave out.",
  ]);
});

test("the list names each image, where it is from, and its URL", async (t) => {
  const long = `data:image/png;base64,${"A".repeat(200)}`;
  const note = [
    "![a](https://ex.com/img/my%20cat.png?w=2) ![b](https://ex.com/avatar)",
    `![c](${long}) ![d](https://ex.com/)`,
  ].join("\n");
  const result = await run(t, undefined, {}, { note });
  assert.deepEqual(result.offered, [
    {
      label: "my cat.png",
      description: "ex.com",
      detail: "https://ex.com/img/my%20cat.png?w=2",
      value: "https://ex.com/img/my%20cat.png?w=2",
    },
    {
      label: "avatar",
      description: "ex.com",
      detail: "https://ex.com/avatar",
      value: "https://ex.com/avatar",
    },
    {
      label: "Embedded image",
      description: "image/png",
      detail: `${long.slice(0, 60)}…`,
      value: long,
    },
    {
      label: "ex.com",
      description: "ex.com",
      detail: "https://ex.com/",
      value: "https://ex.com/",
    },
  ]);
});

test("unticked images are not downloaded and their links stay, in the text and in properties", async (t) => {
  const result = await run(
    t,
    "Download",
    {},
    {
      note: FRONT_NOTE,
      unticked: ["https://ex.com/img/cover.png", "https://ex.com/img/cat.png"],
    },
  );
  assert.deepEqual(result.written, [uriOf("dog.png")]);
  assert.equal(
    result.text,
    [
      "---",
      "title: Trip",
      "cover: https://ex.com/img/cover.png # hero",
      "site: https://ex.com/page",
      "photos:",
      '  - "[[dog.png]]"',
      "  - 'https://ex.com/img/cat.png'",
      "  - https://ex.com/notes.pdf",
      "---",
      "![[dog.png|A dog]]",
    ].join("\n"),
  );
  assert.deepEqual(result.told, ["Downloaded 1 attachment."]);
});

test("accepting the list with every image unticked downloads nothing", async (t) => {
  const result = await run(
    t,
    "Download",
    {},
    {
      note: "![](https://ex.com/img/dog.png)",
      unticked: ["https://ex.com/img/dog.png"],
    },
  );
  assert.deepEqual(result.written, []);
  assert.deepEqual(result.told, []);
  assert.equal(result.text, "![](https://ex.com/img/dog.png)");
});

test("downloads are fetched with redirects checked by hand and a time limit", async (t) => {
  const note = "![](https://ex.com/img/dog.png)";
  const result = await run(t, "Download", {}, { note });
  assert.deepEqual(result.fetched, [
    { url: "https://ex.com/img/dog.png", redirect: "manual", hasSignal: true },
  ]);
});

test("a link to this machine or a private network is never fetched", async (t) => {
  const note = [
    "![a](http://127.0.0.1:8080/admin.png) ![b](http://localhost/b.png)",
    "![c](http://169.254.169.254/latest/meta-data/c.png)",
    "![d](https://ex.com/img/dog.png)",
  ].join("\n");
  const result = await run(t, "Download", {}, { note });
  assert.deepEqual(
    result.fetched.map(({ url }) => url),
    ["https://ex.com/img/dog.png"],
  );
  assert.deepEqual(result.written, [uriOf("dog.png")]);
  assert.equal(
    result.text,
    [
      "![a](http://127.0.0.1:8080/admin.png) ![b](http://localhost/b.png)",
      "![c](http://169.254.169.254/latest/meta-data/c.png)",
      "![[dog.png|d]]",
    ].join("\n"),
  );
  assert.deepEqual(result.told, [
    "Downloaded 1 attachment. 3 could not be downloaded.",
  ]);
});
