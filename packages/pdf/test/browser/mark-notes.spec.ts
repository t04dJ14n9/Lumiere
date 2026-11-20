import { expect, test, type Page } from "@playwright/test";
import {
  lastSelection,
  messages,
  open,
  pagePoint,
  selectText,
  sendAction,
  TEXT_MIDLINE,
} from "./viewer-support";

// Owner-approved (2026-11-20): the note card is a hover, which only a real
// pointer over a drawn mark can show.

/** Highlight the first line's words; returns a point inside the mark. */
async function highlightWords(page: Page): Promise<[number, number]> {
  const at = await pagePoint(page, 1);
  await selectText(page, at(74, TEXT_MIDLINE), at(205, TEXT_MIDLINE));
  await expect
    .poll(async () => (await lastSelection(page)) as { kind?: string } | null)
    .toMatchObject({ kind: "text" });
  await sendAction(page, { action: "markSelection", tool: "highlight" });
  await expect.poll(() => lastSelection(page)).toBeNull();
  return at(140, TEXT_MIDLINE);
}

/** Right-click the mark and pick Edit Note…: its card opens to write in. */
async function editNote(page: Page, inside: [number, number]) {
  await page.mouse.click(...inside, { button: "right" });
  await expect
    .poll(async () => lastSelection(page))
    .toMatchObject({ kind: "region", mark: true });
  await sendAction(page, { action: "editMarkNote" });
  await expect(field(page)).toBeFocused();
}

/** Give the mark under `inside` a note through Edit Note…, and put the pointer away. */
async function setNote(page: Page, inside: [number, number], note: string) {
  await editNote(page, inside);
  await field(page).fill(note);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(field(page)).toHaveCount(0);
  await page.mouse.move(inside[0] + 300, inside[1] + 300);
  await expect(card(page)).toHaveCount(0);
}

/** The notes in the last annotation file the viewer asked to keep. */
async function keptNotes(page: Page): Promise<(string | undefined)[]> {
  const saves = (await messages(page)).filter(
    (m) => m.type === "annotationStoreSave",
  );
  const text = saves.at(-1)?.text;
  return typeof text === "string"
    ? (
        JSON.parse(text) as {
          bundle: { items: { data: { contents?: string } }[] };
        }
      ).bundle.items.map((item) => item.data.contents)
    : [];
}

const card = (page: Page) => page.locator(".note-card");
const field = (page: Page) => page.getByRole("textbox", { name: "Note" });

test("resting on a mark shows its note as Markdown, beside the mark", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  const inside = await highlightWords(page);
  await setNote(page, inside, "**Key** idea\n\n- one\n- `two`");
  await page.mouse.move(inside[0] + 300, inside[1] + 200);
  await expect(card(page)).toHaveCount(0);

  await page.mouse.move(...inside);
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator("strong")).toHaveText("Key");
  await expect(card(page).locator("li")).toHaveCount(2);
  const box = (await card(page).boundingBox())!;
  expect(box.y).toBeGreaterThan(inside[1]);
  expect(box.y).toBeLessThan(inside[1] + 60);

  // Away from mark and card, it closes.
  await page.mouse.move(inside[0] + 300, inside[1] + 300);
  await expect(card(page)).toHaveCount(0);
});

test("a mark without a note shows no card", async ({ page }) => {
  await open(page, "?toolbar=chrome");
  const inside = await highlightWords(page);
  await page.mouse.move(...inside);
  await page.waitForTimeout(800);
  await expect(card(page)).toHaveCount(0);
});

test("a link in a note opens through the extension; the card stays while read", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  const inside = await highlightWords(page);
  await setNote(
    page,
    inside,
    "See [the paper](https://example.com/paper) or [this](javascript:alert(1))",
  );
  await page.mouse.move(...inside);
  await expect(card(page)).toBeVisible();
  const link = card(page).getByRole("link", { name: "the paper" });
  await link.hover();
  await page.waitForTimeout(600);
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByRole("link")).toHaveCount(1);
  await link.click();
  await expect
    .poll(async () =>
      (await messages(page)).filter((m) => m.type === "openExternal"),
    )
    .toEqual([{ type: "openExternal", url: "https://example.com/paper" }]);
});

test("a press or Escape closes the card", async ({ page }) => {
  await open(page, "?toolbar=chrome");
  const inside = await highlightWords(page);
  await setNote(page, inside, "A thought");
  await page.mouse.move(...inside);
  await expect(card(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  await page.mouse.move(inside[0] + 4, inside[1]);
  await expect(card(page)).toBeVisible();
  await page.mouse.down();
  await expect(card(page)).toHaveCount(0);
  await page.mouse.up();
});

test("Edit Note… writes the note in the card; it is kept beside the PDF", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  const inside = await highlightWords(page);
  await editNote(page, inside);
  await expect(field(page)).toHaveValue("");
  await field(page).fill("A **first** thought");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(field(page)).toHaveCount(0);
  // The card shows the note it now has, until the pointer goes elsewhere.
  await expect(card(page).locator("strong")).toHaveText("first");
  await expect.poll(() => keptNotes(page)).toEqual(["A **first** thought"]);

  // Opened again, it starts from that note; Escape leaves it as it was.
  await editNote(page, inside);
  await expect(field(page)).toHaveValue("A **first** thought");
  await field(page).fill("changed");
  await page.keyboard.press("Escape");
  await expect(field(page)).toHaveCount(0);
  await expect(card(page)).toContainText("A first thought");
  await expect.poll(() => keptNotes(page)).toEqual(["A **first** thought"]);
});

test("the card's Edit button writes the note; a press outside keeps it", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  const inside = await highlightWords(page);
  await setNote(page, inside, "before");
  await page.mouse.move(...inside);
  await card(page).getByRole("button", { name: "Edit Note" }).click();
  await expect(field(page)).toBeFocused();
  // Keys typed are the note's: neither Find nor paging takes them.
  await page.keyboard.press("End");
  await page.keyboard.type(" and after");
  await expect(page.locator(".search-bar")).toHaveCount(0);
  await page.mouse.click(inside[0] + 200, inside[1] + 250);
  await expect(card(page)).toHaveCount(0);
  await expect.poll(() => keptNotes(page)).toEqual(["before and after"]);
});

test("emptying a note removes it, and the card closes", async ({ page }) => {
  await open(page, "?toolbar=chrome");
  const inside = await highlightWords(page);
  await setNote(page, inside, "to remove");
  await editNote(page, inside);
  await field(page).fill("");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(card(page)).toHaveCount(0);
  await expect.poll(() => keptNotes(page)).toEqual([""]);
  await page.mouse.move(...inside);
  await page.waitForTimeout(800);
  await expect(card(page)).toHaveCount(0);
});

test("one of Lumiere's own marks offers Edit Note in its card", async ({
  page,
}) => {
  await open(page, "?toolbar=chrome");
  const inside = await highlightWords(page);
  await setNote(page, inside, "mine");
  await page.mouse.move(...inside);
  await expect(
    card(page).getByRole("button", { name: "Edit Note" }),
  ).toBeVisible();
});
