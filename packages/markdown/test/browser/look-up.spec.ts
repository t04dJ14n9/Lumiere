/**
 * macOS Look Up in notes.
 *
 * 1. The native gesture. A force click (hard press on the trackpad) or a
 *    three-finger tap never reaches the page: Chromium itself reads the word
 *    under the pointer from the DOM (Blink's AttributedWordAtPoint) and shows
 *    the Dictionary popover. Lumière can only keep that word readable: real
 *    text under the pointer, not covered, and not `user-select: none`, the
 *    cause of the same bug in VS Code's own editor (microsoft/vscode#85632).
 *    A force click starts as a press, so it must also hold while the button
 *    is down. These checks guard those prerequisites for each kind of text.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { open } from "./harness";

const SOURCE = [
  "# Heading alpha",
  "",
  "Paragraph bravo here.",
  "",
  "Some **charlie** bold.",
  "",
  "See [delta](https://example.com) link.",
  "",
  "- echo item",
  "",
  "> foxtrot quote",
  "",
  "End.",
].join("\n");

/** Each kind of text, by the word in it. */
const PLACES = {
  "a heading": "alpha",
  "a paragraph": "bravo",
  "bold text": "charlie",
  "a rendered link": "delta",
  "a list item": "echo",
  "a blockquote": "foxtrot",
} as const;

interface Point {
  x: number;
  y: number;
}

/** Caret at the end, so every line above is rendered, not revealed as source. */
async function renderAll(page: Page): Promise<void> {
  await page.evaluate((end) => window.harness.reveal(end), SOURCE.length);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

/** The centre of a middle character of `word` as drawn in the note. */
async function glyphCentre(page: Page, word: string): Promise<Point> {
  const point = await page.evaluate((word) => {
    const content = document.querySelector(".cm-content")!;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent!.indexOf(word);
      if (index < 0) {
        continue;
      }
      const middle = index + Math.floor(word.length / 2);
      const glyph = document.createRange();
      glyph.setStart(node, middle);
      glyph.setEnd(node, middle + 1);
      const box = glyph.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    return null;
  }, word);
  expect(point, `${word} is drawn as text`).not.toBeNull();
  return point!;
}

/** What Chromium's word lookup would find at `point`. */
function textAt(page: Page, point: Point) {
  return page.evaluate(({ x, y }) => {
    const caret = document.caretRangeFromPoint(x, y);
    const node = caret?.startContainer;
    if (!caret || !node || node.nodeType !== Node.TEXT_NODE) {
      return null;
    }
    const style = getComputedStyle(node.parentElement!);
    return {
      text: node.textContent ?? "",
      offset: caret.startOffset,
      userSelect:
        style.getPropertyValue("user-select") ||
        style.getPropertyValue("-webkit-user-select"),
      // Nothing drawn over the text takes the hit instead.
      isUncovered: document.elementFromPoint(x, y)?.contains(node) ?? false,
    };
  }, point);
}

async function expectReadableWord(page: Page, point: Point, word: string) {
  const found = await textAt(page, point);
  expect(found, "a text node under the pointer").not.toBeNull();
  const start = found!.text.indexOf(word);
  expect(start, `"${found!.text}" holds ${word}`).toBeGreaterThanOrEqual(0);
  expect(found!.offset).toBeGreaterThanOrEqual(start);
  expect(found!.offset).toBeLessThanOrEqual(start + word.length);
  expect(found!.userSelect).not.toBe("none");
  expect(found!.isUncovered).toBe(true);
}

for (const [place, word] of Object.entries(PLACES)) {
  test(`macOS Look Up (force click, three-finger tap) can read a word in ${place}, also while pressed`, async ({
    page,
  }) => {
    await open(page, SOURCE);
    await renderAll(page);
    const point = await glyphCentre(page, word);
    await expectReadableWord(page, point, word);

    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    // A force click is a press that deepens; macOS looks the word up while
    // the button is still down, so the text must not move or change then.
    await page.waitForTimeout(300);
    await expectReadableWord(page, point, word);
    await page.mouse.up();
  });
}
