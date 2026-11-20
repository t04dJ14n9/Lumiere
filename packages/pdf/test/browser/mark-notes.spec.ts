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

/** Give the mark under `inside` a note, as the context menu does. */
async function setNote(page: Page, inside: [number, number], note: string) {
  await page.mouse.click(...inside, { button: "right" });
  await expect
    .poll(async () => lastSelection(page))
    .toMatchObject({ kind: "region", mark: true });
  await sendAction(page, { action: "setMarkNote", note });
  await page.mouse.click(...inside);
}

const card = (page: Page) => page.locator(".note-card");

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
