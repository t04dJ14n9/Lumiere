import assert from "node:assert/strict";
import { test } from "node:test";
import type { PageRef } from "@embedpdf/engine";
import type { RenderCapability } from "@embedpdf/plugin-render/contract";
import { readRegionDetails } from "../../src/webview/region-details";
import type { TextAccess } from "../../src/webview/text-access";

const page: PageRef = { kind: "objectNumber", objectNumber: 12 };

/** "Hello world" on one line, then "Second row" below it: 10 points per character. */
const LINES = ["Hello world", "Second row"];
const layout = {
  charCount: 22,
  runs: LINES.map((line, row) => ({
    start: row * 11,
    rect: { x: 0, y: row * 20, width: line.length * 10, height: 12 },
    glyphs: [...line].map((character, column) => ({
      loose: { x: column * 10, y: row * 20, width: 10, height: 14 },
      tight: { x: column * 10 + 1, y: row * 20 + 2, width: 8, height: 10 },
      ...(character === " " ? { space: true as const } : {}),
    })),
  })),
};
const text: TextAccess = {
  layoutOf: async () => layout as never,
  textOf: async () => {
    throw new Error("not used");
  },
  slice: async (_page, { start, count }) =>
    LINES.join("").slice(start, start + count),
};

test("the text of a region is the characters inside it, row by row", async () => {
  // From the middle of the "H" to the end of the line: not the "H".
  const details = await readRegionDetails(
    { text, render: null },
    page,
    [8, 0, 110, 14],
  );
  assert.equal(details.text, "ello world");
  const both = await readRegionDetails(
    { text, render: null },
    page,
    [0, 0, 120, 40],
  );
  assert.equal(both.text, "Hello world\nSecond row");
  assert.equal(both.image, undefined, "no render capability: no picture");
});

test("a region over nothing has no text", async () => {
  const details = await readRegionDetails(
    { text, render: null },
    page,
    [200, 100, 300, 140],
  );
  assert.deepEqual(details, { text: "" });
});

test("a PDF that forbids copying gives no text, and the picture still comes", async () => {
  const refused: TextAccess = {
    ...text,
    slice: async () => {
      throw new Error("permission-denied");
    },
  };
  const calls: unknown[] = [];
  const render = {
    renderPage: async (...args: unknown[]) => {
      calls.push(args);
      return { blob: async () => new Blob(["png"]) };
    },
  } as unknown as RenderCapability;
  const reader = globalThis as { FileReader?: unknown };
  const original = reader.FileReader;
  reader.FileReader = class {
    result = "data:image/png;base64,cG5n";
    onload: (() => void) | null = null;
    readAsDataURL(): void {
      queueMicrotask(() => this.onload?.());
    }
  };
  try {
    const details = await readRegionDetails(
      { text: refused, render },
      page,
      [0, 0, 120, 40],
    );
    assert.deepEqual(details, {
      text: "",
      image: "data:image/png;base64,cG5n",
    });
  } finally {
    reader.FileReader = original;
  }
  assert.deepEqual(calls, [
    [
      page,
      {
        rect: { x: 0, y: 0, width: 120, height: 40 },
        scale: 2,
        format: "png",
        includeAnnotations: true,
      },
    ],
  ]);
});

test("a big region is rendered smaller, so its image stays within 2000 pixels", async () => {
  const calls: { scale: number }[] = [];
  const render = {
    renderPage: async (_page: unknown, options: { scale: number }) => {
      calls.push(options);
      throw new Error("not needed");
    },
  } as unknown as RenderCapability;
  await readRegionDetails({ text: null, render }, page, [0, 0, 4000, 1000]);
  assert.equal(calls[0]!.scale, 0.5);
});
