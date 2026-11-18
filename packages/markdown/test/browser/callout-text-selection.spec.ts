import { test, expect, type Page } from "@playwright/test";
import { open } from "./harness";

const source = [
  "Before.",
  "",
  '> [!question]- What does "promiscuous mode" mean here?',
  "> **promiscuous** /prəˈmɪskjuəs/, adjective. Stress the second syllable.",
  ">",
  "> **Meaning:** in everyday English, _promiscuous_ describes something unselective, taking whatever comes.",
  "",
  "After.",
].join("\n");

/** The Live Preview editor of the harness's first view. */
function editorView(page: Page) {
  return page.evaluateHandle(
    () =>
      [...window.harness.views[0]!.plugins].find(
        (fiber) => fiber.definition.name === "livePreview",
      )!.context!.editor.view,
  );
}

/** Open the note and the collapsed callout, with its layout settled. */
async function openCallout(page: Page, focusFirst: boolean) {
  await page.setViewportSize({ width: 960, height: 720 });
  await open(page, source, "obsidian");
  await page.locator(".callout-title").first().click();
  if (focusFirst) {
    await page.locator(".cm-line", { hasText: "After." }).click();
  }
  await expect(page.locator(".callout-content p").last()).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}

/**
 * Drag from the start of "Meaning:" to the end of "describes", measured
 * from the text itself just before the press (a box read earlier can be
 * stale once fonts and the callout's height settle).
 */
async function dragAcross(page: Page) {
  const [from, to] = await page.evaluate(() => {
    const paragraph = [...document.querySelectorAll(".callout-content p")].at(
      -1,
    )!;
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const point = (word: string, end: boolean) => {
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent!.indexOf(word);
        if (at >= 0) {
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + word.length);
          const rect = range.getBoundingClientRect();
          return [
            end ? rect.right - 1 : rect.left + 1,
            rect.top + rect.height / 2,
          ];
        }
      }
      throw new Error(`no ${word}`);
    };
    const start = point("Meaning", false);
    walker.currentNode = paragraph;
    return [start, point("describes", true)];
  });
  await page.mouse.move(from![0]!, from![1]!);
  await page.mouse.down();
  await page.mouse.move(to![0]!, to![1]!, { steps: 12 });
  await page.mouse.up();
}

const nativeSelection = (page: Page) =>
  page.evaluate(() => String(window.getSelection()));

for (const focusFirst of [false, true]) {
  test(`a drag selects a callout's rendered text (${focusFirst ? "editor focused" : "editor not focused"})`, async ({
    page,
  }) => {
    await openCallout(page, focusFirst);
    await dragAcross(page);
    // Selected as text, and the callout stays rendered.
    await expect.poll(() => nativeSelection(page)).toMatch(/^Meaning: in /u);
    await expect(page.locator(".hybrid-callout")).toHaveCount(1);
    expect(await page.locator(".cm-line").allTextContents()).not.toContain(
      '> [!question]- What does "promiscuous mode" mean here?',
    );

    // An editor update that moves nothing leaves the selection where it is.
    const view = await editorView(page);
    await view.evaluate((view) => view.dispatch({}));
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    expect(await nativeSelection(page)).toMatch(/^Meaning: in /u);

    // Copy takes the rendered text, not CodeMirror's line.
    const copied = await page.evaluate(() => {
      const data = new DataTransfer();
      const event = new ClipboardEvent("copy", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      });
      document.activeElement?.dispatchEvent(event);
      return {
        text: data.getData("text/plain"),
        handledByEditor: event.defaultPrevented,
      };
    });
    expect(copied.handledByEditor).toBe(false);
    expect(await page.evaluate(() => window.harness.text)).toBe(source);
  });
}

test("a plain click on a callout's text still reveals its source", async ({
  page,
}) => {
  await openCallout(page, true);
  const box = (await page.locator(".callout-content p").last().boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await expect(
    page.locator(".cm-line", { hasText: "[!question]-" }),
  ).toHaveCount(1);
});

test("a key after a rendered selection types at the editor's caret", async ({
  page,
}) => {
  await openCallout(page, true);
  await dragAcross(page);
  await expect.poll(() => nativeSelection(page)).toMatch(/^Meaning/u);
  await page.keyboard.type("!");
  await expect
    .poll(() => page.evaluate(() => window.harness.text))
    .toBe(source.replace(/After\.$/u, "After.!"));
});
