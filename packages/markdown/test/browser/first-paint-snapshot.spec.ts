import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { config as editorConfig } from "../../src/plugins/editor/manifest";
import { webviewSnapshot } from "../../src/plugins/editor/snapshot";
import { servePage } from "./page-server";
import type {} from "./fake-host";

/**
 * The host puts the note's first screen in the page's first HTML
 * (plugins/editor/snapshot.ts); the editor mounts beneath it and the snapshot
 * goes once the editor has settled. Nothing may move at that swap: every line
 * the snapshot drew must sit where the editor then puts it.
 */
const PAGE =
  '<!doctype html><html><head><link rel="stylesheet" href="/dist/webview/editor.css"></head><body><main id="app" data-pdfium-wasm="/dist/webview/embedpdf.wasm"></main><script src="/artifacts/fake-host.js"></script></body></html>';

const LONG = `${"A long paragraph that wraps over several lines when the window is narrow, with a [[Wiki link]] and **bold words** in it. ".repeat(5)}`;

const NOTES = {
  prose: [
    "# Heading one",
    "",
    "Paragraph with **bold**, *italic*, `code`, ~~strike~~, ==mark==, a [link](https://example.com), an [internal](Note.md) link, [[Wiki]], [[Wiki|alias]], [[#Local]], #tag/nested and https://bare.example.com.",
    "",
    "## Heading two",
    "",
    "- item",
    "  - nested item",
    "    - deeper item with `code`",
    "- another item with **bold**",
    "",
    "1. first",
    "2. second",
    "10. tenth",
    "",
    "> quote line",
    "> second quote line with *emphasis*",
    "",
    "---",
    "",
    "```ts",
    "const x = 1;",
    "\ttabbed();",
    "",
    "```",
    "",
    LONG,
    "",
    "### Heading three",
    "",
    "Closing paragraph.",
  ].join("\n"),
  frontmatter: [
    "---",
    "title: A note",
    "tags:",
    "  - one",
    "  - two",
    "status: open",
    "---",
    "",
    "# Body",
    "",
    "Text under the properties with a [[Link]].",
    "",
    "- list",
  ].join("\n"),
  paragraphFirst: [
    "Plain first line of the note.",
    "",
    "## Next",
    "",
    "Done.",
  ].join("\n"),
  // The snapshot ends before the table; the lines above it must still match.
  tableAfterText: [
    "# Title",
    "",
    "Intro text.",
    "",
    "| a | b |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "After the table.",
  ].join("\n"),
};

interface Box {
  top: number;
  left: number;
  height: number;
  textLeft: number;
  textWidth: number;
}

/** What the host knew when it built the snapshot, and what the editor is then sent. */
interface Settings {
  host?: Record<string, unknown>;
  editor?: Record<string, unknown>;
}

async function openUnderSnapshot(
  page: Page,
  source: string,
  { host = {}, editor = host }: Settings = {},
  width = 900,
) {
  await page.setViewportSize({ width, height: 700 });
  await servePage(page, PAGE);
  await page.addStyleTag({
    content:
      "#app > section.panel { flex: 1; min-height: 0; display: flex; flex-direction: column; }",
  });
  const html = webviewSnapshot(
    source,
    {
      preset: "obsidian",
      mode: "livePreview",
      editor: editorConfig.parse(host),
    },
    "mac",
  );
  expect(html).not.toBe("");
  return page.evaluate(
    async ({ source, html, editor }) => {
      const boxes = (root: Element, selector: string): Box[] =>
        [...root.querySelectorAll(selector)].map((line) => {
          const rect = line.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(line);
          const text = range.getBoundingClientRect();
          const isBlank = !line.textContent;
          return {
            top: rect.top,
            left: rect.left,
            height: rect.height,
            textLeft: isBlank ? 0 : text.left,
            textWidth: isBlank ? 0 : text.width,
          };
        });
      document.getElementById("app")!.innerHTML = html;
      const drawn = boxes(
        document.querySelector(".mw-snapshot")!,
        ".mw-snapshot-text > .cm-line",
      );
      window.harness = new window.BrowserHost(source);
      window.harness.features = {};
      window.harness.notes = {};
      window.harness.editorSettings = editor;
      await window.harness.open("obsidian");
      const wasDropped = !document.querySelector(".mw-snapshot");
      for (let wait = 0; document.querySelector(".mw-snapshot"); wait++) {
        if (wait > 400) {
          throw new Error("The snapshot was never removed");
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      return {
        drawn,
        live: boxes(
          document.querySelector(".cm-content")!,
          ":scope > .cm-line",
        ),
        wasDropped,
        featuresLoaded: performance.getEntriesByName("mw:features").length > 0,
      };
    },
    { source, html, editor },
  );
}

/** Lines of the snapshot that sit more than `tolerance` px from the editor's. */
function movedLines(drawn: Box[], live: Box[], tolerance: number) {
  return drawn.flatMap((box, index) => {
    const editor = live[index]!;
    const delta = {
      top: box.top - editor.top,
      left: box.left - editor.left,
      height: box.height - editor.height,
      textLeft: box.textLeft - editor.textLeft,
      textWidth: box.textWidth - editor.textWidth,
    };
    return Object.values(delta).some((px) => Math.abs(px) > tolerance)
      ? [{ index, ...delta }]
      : [];
  });
}

for (const [name, source] of Object.entries(NOTES)) {
  test(`${name}: the first screen does not move when the editor replaces it`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const opened = await openUnderSnapshot(page, source);
    expect(opened.wasDropped).toBe(false);
    expect(opened.featuresLoaded).toBe(true);
    expect(opened.drawn.length).toBeGreaterThan(2);
    // The sheet's skeleton is laid out by the browser as the sheet is, so the
    // lines below it do not move either.
    expect(
      movedLines(opened.drawn, opened.live, 0.5),
      "lines that move at the swap",
    ).toEqual([]);
  });
}

test("a larger font and line height do not move it either", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const settings = { fontSize: 21, lineHeight: 1.7 };
  const opened = await openUnderSnapshot(page, NOTES.prose, {
    host: settings,
  });
  expect(opened.wasDropped).toBe(false);
  expect(movedLines(opened.drawn, opened.live, 0.5)).toEqual([]);
});

// Lines break where the editor's hidden syntax leaves a break opportunity
// (its widget buffers), so the text is checked at many widths and sizes.
for (const fontSize of [16, 21]) {
  for (const width of [380, 470, 560, 650, 740, 830]) {
    test(`wrapping at ${width}px wide, ${fontSize}px text, is the editor's`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      const opened = await openUnderSnapshot(
        page,
        NOTES.prose,
        { host: { fontSize } },
        width,
      );
      expect(opened.wasDropped).toBe(false);
      expect(movedLines(opened.drawn, opened.live, 0.5)).toEqual([]);
    });
  }
}

test("a snapshot built for other settings goes as soon as the editor knows them", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const opened = await openUnderSnapshot(page, NOTES.prose, {
    host: {},
    editor: { fontSize: 20 },
  });
  expect(opened.wasDropped).toBe(true);
});
