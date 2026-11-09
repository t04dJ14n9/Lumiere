import { test, expect, chromium } from "@playwright/test";
import type { Frame, Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { paths, readState } from "./state";
import {
  closeBrowser,
  command,
  openWorkbench,
  workbenchPage,
} from "./workbench";

/**
 * Within this many pixels counts as at the top: CodeMirror's default yMargin
 * plus half a line of rounding.
 */
const TOLERANCE = 10;
const FILLER = Array.from({ length: 80 }, (_, n) => `Filler ${n}.`).join(
  "\n\n",
);
const NOTE = [
  "# Title",
  "## Early",
  FILLER,
  "## Middle",
  FILLER,
  "## Late",
  FILLER,
  "## Last",
].join("\n\n");

async function editorFrame(page: Page): Promise<Frame> {
  for (const frame of page.frames()) {
    if (await frame.locator(".cm-line").count()) {
      return frame;
    }
  }
  throw new Error("No Lumiere frame");
}

async function geometry(frame: Frame, title: string) {
  return frame.evaluate((title) => {
    const scroller = document.querySelector(".cm-scroller")!;
    const box = scroller.getBoundingClientRect();
    const line = [...document.querySelectorAll(".cm-line")].find(
      (candidate) => candidate.textContent?.replace(/^#+ /, "") === title,
    );
    const rect = line?.getBoundingClientRect();
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

/** Clicks a heading in the Markdown Outline view of the Explorer, as a user does. */
async function clickOutline(page: Page, title: string) {
  const header = page.getByRole("button", { name: "Markdown Outline Section" });
  if ((await header.getAttribute("aria-expanded")) !== "true") {
    await header.click();
  }
  const row = page
    .locator(".pane-body .monaco-list-row")
    .filter({ has: page.getByText(title, { exact: true }) });
  await expect(row.first()).toBeVisible();
  await row.first().click();
}

function distanceFromTop(g: Awaited<ReturnType<typeof geometry>>): number {
  return g.headingTop === undefined
    ? Infinity
    : Math.abs(g.headingTop - g.viewportTop);
}

async function expectAtTop(page: Page, title: string) {
  await expect
    .poll(async () =>
      distanceFromTop(await geometry(await editorFrame(page), title)),
    )
    .toBeLessThanOrEqual(TOLERANCE);
}

test("clicking a heading in the Markdown Outline puts it at the top of the editor, clamping at both ends of the note", async () => {
  const note = path.join(paths.workspace, "Note.md");
  const original = readFileSync(note, "utf8");
  writeFileSync(note, NOTE);
  const browser = await chromium.connectOverCDP(readState().webSocket);
  try {
    const page = workbenchPage(browser);
    await openWorkbench(page);
    await command(page, "View: Show Explorer");
    await clickOutline(page, "Middle");
    await expectAtTop(page, "Middle");
    await clickOutline(page, "Late");
    await expectAtTop(page, "Late");

    // Early sits under Title; with y:"start" it scrolls to the top of the
    // viewport (Title may leave). Near-start clamp still holds for a heading
    // that cannot scroll further up once it is already flush with the top.
    await clickOutline(page, "Early");
    await expectAtTop(page, "Early");
    const early = await geometry(await editorFrame(page), "Early");
    expect(early.headingTop!).toBeGreaterThanOrEqual(early.viewportTop - 1);

    // "Last" is the final line, so the scroll range ends before it can reach the top.
    await clickOutline(page, "Last");
    await expect
      .poll(async () => {
        const g = await geometry(await editorFrame(page), "Last");
        // Browser harness measured gap 0 under y:"start"; bind to suite
        // TOLERANCE (10 here) rather than an arbitrary 30px slack.
        return Math.abs(g.scrollTop - g.maxScrollTop);
      })
      .toBeLessThanOrEqual(TOLERANCE);
    const last = await geometry(await editorFrame(page), "Last");
    expect(last.headingTop!).toBeGreaterThan(last.viewportTop + TOLERANCE);
    expect(last.headingTop!).toBeLessThan(last.viewportBottom);
  } finally {
    writeFileSync(note, original);
    await closeBrowser(browser);
  }
});
