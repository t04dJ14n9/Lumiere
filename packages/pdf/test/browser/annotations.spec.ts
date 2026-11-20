import { expect, test, type Page } from "@playwright/test";
import {
  open,
  sendAction,
  pagePoint,
  lastView,
  lastSelection,
  selectText,
  TEXT_MIDLINE,
} from "./viewer-support";

/** EmbedPDF highlight marks use multiply blend rectangles inside the page. */
async function highlightMarkCount(page: Page) {
  return page.evaluate(
    () =>
      document.querySelectorAll(
        '.page [style*="mix-blend-mode: multiply"], .page [style*="mix-blend-mode:multiply"]',
      ).length,
  );
}

/** The messages the viewer sent of one type. */
const sent = (page: Page, type: string) =>
  page.evaluate(
    (type) =>
      (
        window as unknown as {
          __messages: { type: string; text?: string | null }[];
        }
      ).__messages.filter((message) => message.type === type),
    type,
  );

type KeptItem = {
  data: { subtype: string; contents?: string; color?: string };
};

/** The marks in the last annotation file the viewer asked to keep. */
async function keptMarks(page: Page): Promise<KeptItem[]> {
  const saves = await sent(page, "annotationStoreSave");
  const last = saves.at(-1)?.text;
  return last
    ? (JSON.parse(last) as { bundle: { items: KeptItem[] } }).bundle.items
    : [];
}

/** The keys VS Code's webview context menu would get, read as the menu opens. */
async function menuKeys(page: Page): Promise<Record<string, boolean>> {
  const value = await page.evaluate(() =>
    document.body.getAttribute("data-vscode-context"),
  );
  return JSON.parse(value ?? "{}") as Record<string, boolean>;
}

/** Select the first line's words, as a reader would before right-clicking. */
async function selectWords(page: Page) {
  const at = await pagePoint(page, 1);
  await selectText(page, at(74, TEXT_MIDLINE), at(205, TEXT_MIDLINE));
  await expect
    .poll(async () => (await lastSelection(page)) as { kind?: string } | null)
    .toMatchObject({ kind: "text" });
  return at;
}

/** Highlight the first line's words from the context menu; returns a point inside the mark. */
async function highlightWords(page: Page) {
  const baseline = await highlightMarkCount(page);
  const at = await selectWords(page);
  await sendAction(page, { action: "markSelection", tool: "highlight" });
  await expect.poll(() => highlightMarkCount(page)).toBeGreaterThan(baseline);
  return { baseline, inside: at(140, TEXT_MIDLINE), at };
}

test("there is no Annotate mode to switch to", async ({ page }) => {
  await open(page, "?toolbar=chrome");
  await sendAction(page, { action: "setTool", tool: "annotate" });
  await expect.poll(() => lastView(page)).toMatchObject({ tool: "text" });
  await expect(
    page.getByRole("button", { name: "Annotate", exact: true }),
  ).toHaveCount(0);
});

test("a right-click on selected text offers to mark it", async ({ page }) => {
  await open(page, "?toolbar=chrome");
  const at = await selectWords(page);
  await page.mouse.click(...at(140, TEXT_MIDLINE), { button: "right" });
  expect(await menuKeys(page)).toMatchObject({
    "lumiere.pdf.hasSelection": true,
    "lumiere.pdf.hasTextSelection": true,
    "lumiere.pdf.hasAnnotationSelection": false,
  });
});

test("Highlight marks the selected text and keeps it beside the PDF", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  await highlightWords(page);
  // The text selection became the mark.
  await expect.poll(() => lastSelection(page)).toBeNull();
  // The mark is kept in Lumiere's annotation file, not written into the PDF:
  // its bytes (and their hash, which a vault records) stay as they were.
  await expect
    .poll(async () => (await keptMarks(page)).map((item) => item.data.subtype))
    .toContain("highlight");
  const kept = JSON.parse(
    (await sent(page, "annotationStoreSave")).at(-1)!.text!,
  ) as { version: number };
  expect(kept.version).toBe(2);
  expect(await sent(page, "annotationSave")).toHaveLength(0);
});

test("Underline marks the selected text", async ({ page }) => {
  await open(page, "?toolbar=chrome");
  await selectWords(page);
  await sendAction(page, { action: "markSelection", tool: "underline" });
  await expect
    .poll(async () => (await keptMarks(page)).map((item) => item.data.subtype))
    .toContain("underline");
});

test("a right-click on a mark offers its note, colour and Delete", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  const { baseline, inside } = await highlightWords(page);
  // Kept before the right-click: only Lumiere's own marks answer the menu.
  await expect
    .poll(async () => (await keptMarks(page)).map((item) => item.data.subtype))
    .toEqual(["highlight"]);
  await page.mouse.click(...inside, { button: "right" });
  expect(await menuKeys(page)).toMatchObject({
    "lumiere.pdf.hasSelection": true,
    "lumiere.pdf.hasTextSelection": false,
    "lumiere.pdf.hasAnnotationSelection": true,
  });
  // Reported as the selection: Copy Link for Agent hands the mark over.
  await expect
    .poll(async () => lastSelection(page))
    .toMatchObject({ kind: "region", mark: true });

  // Edit Note… opens the mark's note card to write in (mark-notes.spec.ts).
  await sendAction(page, { action: "editMarkNote" });
  await page.getByRole("textbox", { name: "Note" }).fill("First thought");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect
    .poll(async () => (await keptMarks(page)).map((item) => item.data.contents))
    .toEqual(["First thought"]);
  // Opened again on the mark, Edit Note… starts from that note.
  await page.mouse.click(...inside);
  await page.mouse.click(...inside, { button: "right" });
  await expect
    .poll(async () => lastSelection(page))
    .toMatchObject({ kind: "region", mark: true, note: "First thought" });

  await sendAction(page, { action: "setMarkColor", color: "#4DABF7" });
  await expect
    .poll(async () =>
      (await keptMarks(page)).map((item) => item.data.color?.toUpperCase()),
    )
    .toEqual(["#4DABF7"]);

  await sendAction(page, { action: "deleteSelectedAnnotations" });
  await expect.poll(() => highlightMarkCount(page)).toBe(baseline);
  await expect.poll(() => lastSelection(page)).toBeNull();
});

test("a right-click on empty page offers no mark actions", async ({ page }) => {
  await open(page, "?toolbar=chrome");
  const { at } = await highlightWords(page);
  await page.mouse.click(...at(150, 250), { button: "right" });
  expect(await menuKeys(page)).toMatchObject({
    "lumiere.pdf.hasTextSelection": false,
    "lumiere.pdf.hasAnnotationSelection": false,
  });
});

// EmbedPDF 3 decides this by the active tool: the reading tool lacks the
// annotation-edit ability, so a click never selects, moves or deletes a mark.
test("a left click on a mark neither selects nor deletes it", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  const { inside } = await highlightWords(page);
  const marked = await highlightMarkCount(page);
  await page.mouse.click(...inside);
  await page.keyboard.press("Delete");
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expect(await highlightMarkCount(page)).toBe(marked);
});

test("annotation undo clears an in-session highlight", async ({ page }) => {
  await open(page, "?toolbar=chrome");
  const { baseline } = await highlightWords(page);
  await sendAction(page, { action: "annotationUndo" });
  await expect.poll(() => highlightMarkCount(page)).toBe(baseline);
});

test("text still selects with marks on the page", async ({ page }) => {
  await open(page, "?toolbar=chrome");
  await highlightWords(page);
  await selectWords(page);
});
