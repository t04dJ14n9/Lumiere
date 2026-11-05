import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { open as openNote } from "./harness";

/**
 * Within this many pixels counts as at the top: CodeMirror's default yMargin
 * (5) plus half a line of rounding.
 */
const TOLERANCE = 8;

/** Sixty sections of ten body lines, so the note is many viewports tall. */
function longNote(): { source: string; offsetOf: (title: string) => number } {
  const parts: string[] = [];
  for (let n = 1; n <= 60; n++) {
    parts.push(`## Section ${n}`, "");
    for (let line = 1; line <= 10; line++) {
      parts.push(`Body of section ${n}, line ${line}.`, "");
    }
  }
  const source = parts.join("\n");
  return {
    source,
    offsetOf: (title) => source.indexOf(`## ${title}`),
  };
}

async function geometry(page: Page, title: string) {
  return page.evaluate((title) => {
    const scroller = document.querySelector(".cm-scroller")!;
    const box = scroller.getBoundingClientRect();
    const line = [...document.querySelectorAll(".cm-line")].find(
      (candidate) => candidate.textContent?.replace(/^#+ /, "") === title,
    );
    // The heading's text: its line also holds the space above the heading.
    const text = line ? document.createRange() : undefined;
    text?.selectNodeContents(line!);
    const rect = text?.getBoundingClientRect();
    return {
      viewportCenter: box.top + box.height / 2,
      viewportTop: box.top,
      viewportBottom: box.bottom,
      headingTop: rect?.top,
      headingCenter: rect ? rect.top + rect.height / 2 : undefined,
      scrollTop: scroller.scrollTop,
      maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
    };
  }, title);
}

async function clickOutline(page: Page, offset: number) {
  await page.evaluate(
    (at) => window.harness.navigate({ fragment: "", at }),
    offset,
  );
}

function distanceFromTop(g: Awaited<ReturnType<typeof geometry>>): number {
  return g.headingTop === undefined
    ? Infinity
    : Math.abs(g.headingTop - g.viewportTop);
}

/**
 * The harness mounts the editor in a plain block; the real webview gives it
 * the window's height. Constrain the scroller the same way so the editor
 * scrolls inside its own viewport instead of growing to the height of the note.
 */
async function open(page: Page, source: string) {
  await openNote(page, source);
  await page.addStyleTag({
    content:
      "#app, #app .cm-editor, #app .cm-scroller { height: 640px !important; max-height: 640px !important; } #app .cm-scroller { overflow: auto !important; }",
  });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector(".cm-scroller")!.clientHeight),
    )
    .toBeLessThanOrEqual(700);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
});

for (const title of ["Section 5", "Section 30", "Section 55"]) {
  test(`outline click puts "${title}" at the top of the viewport`, async ({
    page,
  }) => {
    const { source, offsetOf } = longNote();
    await open(page, source);
    await clickOutline(page, offsetOf(title));
    await expect
      .poll(async () => distanceFromTop(await geometry(page, title)))
      .toBeLessThanOrEqual(TOLERANCE);
  });
}

test("a heading already on screen is still moved to the top", async ({
  page,
}) => {
  const { source, offsetOf } = longNote();
  await open(page, source);
  await clickOutline(page, offsetOf("Section 30"));
  await clickOutline(page, offsetOf("Section 29"));
  await expect
    .poll(async () => distanceFromTop(await geometry(page, "Section 29")))
    .toBeLessThanOrEqual(TOLERANCE);
  // Section 29 is a full section (about 1000px) above 30, so this is a long
  // jump; the next click goes back by a few lines only.
  await clickOutline(page, offsetOf("Section 29") + 1);
  const after = await geometry(page, "Section 29");
  expect(distanceFromTop(after)).toBeLessThanOrEqual(TOLERANCE);
});

test("the first heading clamps at the top of the note", async ({ page }) => {
  const { source, offsetOf } = longNote();
  await open(page, source);
  await clickOutline(page, offsetOf("Section 30"));
  await clickOutline(page, offsetOf("Section 1"));
  await expect
    .poll(async () => (await geometry(page, "Section 1")).scrollTop)
    .toBe(0);
  const g = await geometry(page, "Section 1");
  expect(distanceFromTop(g)).toBeLessThanOrEqual(TOLERANCE);
});

/** Filler paragraphs, so a note is many viewports tall. */
const FILLER = Array.from({ length: 80 }, (_, n) => `Filler ${n}.`).join(
  "\n\n",
);

test("a heading near the start clamps at the top: aligning to the top would need a negative scroll", async ({
  page,
}) => {
  // Early is the first heading, so y:"start" and y:"center" both clamp at 0.
  const source = `## Early\n\n${FILLER}\n\n## Far\n\n${FILLER}`;
  await open(page, source);
  await clickOutline(page, source.indexOf("## Far"));
  await expect
    .poll(async () => (await geometry(page, "Far")).scrollTop)
    .toBeGreaterThan(0);
  await clickOutline(page, source.indexOf("## Early"));
  await expect
    .poll(async () => (await geometry(page, "Early")).scrollTop)
    .toBe(0);
  const g = await geometry(page, "Early");
  expect(distanceFromTop(g)).toBeLessThanOrEqual(TOLERANCE);
});

test("a heading on the last line clamps at the bottom of the scroll range", async ({
  page,
}) => {
  const source = `# Title\n\n${FILLER}\n\n## Last`;
  await open(page, source);
  await clickOutline(page, source.indexOf("## Last"));
  await expect
    .poll(async () => {
      const g = await geometry(page, "Last");
      // CodeMirror may stop a few pixels short of the computed max (yMargin /
      // padding); within a line height still means the scroll range ended.
      return Math.abs(g.scrollTop - g.maxScrollTop);
    })
    .toBeLessThanOrEqual(30);
  const g = await geometry(page, "Last");
  expect(g.scrollTop).toBeGreaterThan(0);
  // Cannot put the last line at the top; it stays below the top of the viewport.
  expect(g.headingTop!).toBeGreaterThan(g.viewportTop + TOLERANCE);
  expect(g.headingTop!).toBeLessThan(g.viewportBottom);
});

test("a heading in a note shorter than the viewport does not scroll", async ({
  page,
}) => {
  await open(page, "# One\n\ntext\n\n## Two\n\nmore\n");
  await clickOutline(page, "# One\n\ntext\n\n".length);
  const g = await geometry(page, "Two");
  expect(g.scrollTop).toBe(0);
  expect(g.maxScrollTop).toBeLessThanOrEqual(0);
});

/**
 * Nested jump: parent becomes sticky after the scroll, so a plain y:"start"
 * lands the child under the pin. Expect the heading below sticky chrome.
 */
test("a nested outline jump keeps the heading below sticky chrome", async ({
  page,
}) => {
  const filler = Array.from(
    { length: 40 },
    (_, n) => `Para under A ${n}.`,
  ).join("\n\n");
  const source = `# Chapter A\n\n${filler}\n\n## Section A1\n\n${filler}\n\n# Chapter B\n\n${filler}`;
  await openNote(page, source, "obsidian", {
    features: { stickyScroll: { enabled: true, config: { maxLines: 5 } } },
  });
  await page.addStyleTag({
    content:
      "#app, #app .cm-editor, #app .cm-scroller { height: 640px !important; max-height: 640px !important; } #app .cm-scroller { overflow: auto !important; }",
  });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector(".cm-scroller")!.clientHeight),
    )
    .toBeLessThanOrEqual(700);

  await clickOutline(page, source.indexOf("## Section A1"));

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const sticky = document.querySelector(
          ".mw-sticky-scroll",
        ) as HTMLElement | null;
        if (!sticky || sticky.hidden) {
          return 0;
        }
        return sticky.getBoundingClientRect().height;
      }),
    )
    .toBeGreaterThan(0);

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const sticky = document.querySelector(
          ".mw-sticky-scroll",
        ) as HTMLElement;
        const labels = [
          ...sticky.querySelectorAll("button.mw-sticky-heading"),
        ].map((button) => button.textContent ?? "");
        return labels.some((label) => /Chapter A/i.test(label));
      }),
    )
    .toBe(true);

  // Heading text top must sit at or below the sticky pin's bottom (not under it).
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const sticky = document.querySelector(
          ".mw-sticky-scroll",
        ) as HTMLElement;
        const line = [...document.querySelectorAll(".cm-line")].find(
          (candidate) =>
            candidate.textContent?.replace(/^#+ /, "") === "Section A1",
        );
        if (!line) {
          return -999;
        }
        const text = document.createRange();
        text.selectNodeContents(line);
        return (
          text.getBoundingClientRect().top -
          sticky.getBoundingClientRect().bottom
        );
      }),
    )
    .toBeGreaterThanOrEqual(-TOLERANCE);
});
