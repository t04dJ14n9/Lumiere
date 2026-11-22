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
 * A jump from the Markdown Outline to a heading in a note of plain text, whose
 * parent heading the sticky bar pins only once the jump has scrolled. Every
 * frame from the jump on is sampled, and each must already have the heading
 * where it settles, below the bar: a frame with the heading under the bar,
 * then the whole note shifting by the bar's height, is a flicker on every
 * click. (outline-jump-flash.spec.ts holds a jump to a loading image, which
 * moves the note on its own, to a much coarser tolerance.)
 */

/** How far a painted frame may be from where the heading settles. */
const TOLERANCE = 2;

function section(n: number): string {
  return [
    `## Topic ${n}`,
    `Paragraph ${n}: ` + "some ordinary words in a note ".repeat(30),
    `> [!note] Callout ${n}\n> Inside the callout ${n}.`,
    `- item a${n}\n- item b${n}\n  - nested ${n}`,
    "```js\nconst x = " + n + ";\nconsole.log(x);\n```",
    `| k | v |\n| - | - |\n| a | ${n} |\n| b | ${n * 2} |`,
    ...(n === 3 ? [`### Sub ${n}`] : []),
    "More text with **bold** and a [[Note]] link and $x^" +
      n +
      "$ math. ".repeat(8),
  ].join("\n\n");
}

const NOTE = [
  "# Long note",
  ...Array.from({ length: 6 }, (_, n) => section(n)),
].join("\n\n");

interface Jump {
  title: string;
  /** The headings the bar pins above it once it lands, when it pins any. */
  parents?: string[];
  /** The row the Outline shows it under (a collapsed one is opened first). */
  under?: string;
}

/** Where each jump goes. */
const JUMPS: Jump[] = [
  { title: "Topic 4", parents: ["Long note"] },
  { title: "Topic 1", parents: ["Long note"] },
  { title: "Topic 5", parents: ["Long note"] },
  { title: "Topic 0", parents: ["Long note"] },
  // Last: its opened parent pushes the rows below it out of the small pane.
  { title: "Sub 3", parents: ["Long note", "Topic 3"], under: "Topic 3" },
];

async function editorFrame(page: Page): Promise<Frame> {
  for (const frame of page.frames()) {
    if (await frame.locator(".cm-line").count()) {
      return frame;
    }
  }
  throw new Error("No Lumiere frame");
}

function outlineRow(page: Page, title: string) {
  return page
    .locator(".pane-body .monaco-list-row")
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
}

/** Opens a collapsed row, as its twistie does: the note is not jumped to. */
async function expandOutlineRow(page: Page, title: string) {
  const row = outlineRow(page, title);
  await expect(row).toBeVisible();
  if ((await row.getAttribute("aria-expanded")) === "false") {
    await row.locator(".monaco-tl-twistie").click();
  }
}

async function clickOutline(page: Page, title: string) {
  const header = page.getByRole("button", { name: "Markdown Outline Section" });
  if ((await header.getAttribute("aria-expanded")) !== "true") {
    await header.click();
  }
  const row = outlineRow(page, title);
  await expect(row).toBeVisible();
  await row.click();
}

interface Sample {
  scrollTop: number;
  /** The heading's text, in px below the top of the scroller. */
  heading: number | undefined;
  /** The bottom of the sticky bar, in px below the top of the scroller. */
  stickyBottom: number;
  sticky: string;
}

/**
 * One sample per frame, taken where the browser is about to paint it: in a
 * resize observer, which runs after the frame's animation callbacks (the
 * editor's measuring, and the corrections that follow it) and its layout, and
 * before paint. A callback of its own, in the frame's list of them, could
 * run between the editor's and so sample a state that is never painted. A
 * frame callback resizes the observed element, so every frame has a sample.
 */
async function watchFrames(frame: Frame, title: string) {
  await frame.evaluate((title) => {
    const scroller = document.querySelector<HTMLElement>(".cm-scroller")!;
    const samples: Sample[] = [];
    let stopped = false;
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;top:0;left:0;height:1px;width:1px;pointer-events:none;";
    document.body.append(probe);
    const sample = () => {
      const top = scroller.getBoundingClientRect().top;
      const line = [...document.querySelectorAll(".cm-line")].find(
        (candidate) => candidate.textContent?.replace(/^#+ /, "") === title,
      );
      const text = line ? document.createRange() : undefined;
      text?.selectNodeContents(line!);
      const bar = document.querySelector<HTMLElement>(".mw-sticky-scroll");
      const visible = bar && !bar.hidden;
      samples.push({
        scrollTop: scroller.scrollTop,
        heading: text ? text.getBoundingClientRect().top - top : undefined,
        stickyBottom: visible ? bar.getBoundingClientRect().bottom - top : 0,
        sticky: visible ? (bar.textContent ?? "") : "",
      });
    };
    const observer = new ResizeObserver(sample);
    observer.observe(probe);
    let width = 1;
    const resize = () => {
      if (stopped) {
        return;
      }
      width = width === 1 ? 2 : 1;
      probe.style.width = `${width}px`;
      requestAnimationFrame(resize);
    };
    requestAnimationFrame(resize);
    (
      window as unknown as { __jump: { samples: Sample[]; stop: () => void } }
    ).__jump = {
      samples,
      stop: () => {
        stopped = true;
        observer.disconnect();
        probe.remove();
      },
    };
  }, title);
  return () =>
    frame.evaluate(() => {
      const store = (
        window as unknown as {
          __jump: { samples: Sample[]; stop: () => void };
        }
      ).__jump;
      store.stop();
      return store.samples;
    });
}

/**
 * A note whose first heading has a section right under it: when that section
 * is at the top, its parent is still on screen and no bar covers it, so the
 * room a jump reserved for the bar must not be taken back.
 */
const NEAR_TOP_NOTE = [
  "# Near top\n## Early",
  ...Array.from({ length: 60 }, (_, n) => `Filler ${n}.`),
  "## Far",
  ...Array.from({ length: 60 }, (_, n) => `Filler ${n}.`),
].join("\n\n");

const NEAR_TOP_JUMPS: Jump[] = [
  { title: "Far", parents: ["Near top"] },
  { title: "Early" },
];

async function expectSteadyJumps(note: string, jumps: Jump[]) {
  const notePath = path.join(paths.workspace, "Note.md");
  const original = readFileSync(notePath, "utf8");
  writeFileSync(notePath, note);
  const browser = await chromium.connectOverCDP(readState().webSocket);
  try {
    const page = workbenchPage(browser);
    await openWorkbench(page);
    await command(page, "View: Show Explorer");
    // A toast left by an earlier spec can cover the Outline's header.
    await command(page, "Notifications: Clear All Notifications");
    for (const { title, parents = [], under } of jumps) {
      if (under) {
        await expandOutlineRow(page, under);
      }
      const frame = await editorFrame(page);
      const before = await frame.evaluate(
        () => document.querySelector(".cm-scroller")!.scrollTop,
      );
      const stop = await watchFrames(frame, title);
      await clickOutline(page, title);
      // Long enough for the held jump to settle.
      await page.waitForTimeout(1500);
      const samples = await stop();
      const jumped = samples.findIndex((sample) => sample.scrollTop !== before);
      expect(jumped, `${title}: the jump scrolled`).toBeGreaterThanOrEqual(0);
      const after = samples.slice(jumped);
      const settled = after.at(-1)!;
      expect(settled.heading, `${title}: landed`).toBeDefined();
      for (const parent of parents) {
        expect(settled.sticky, `${title}: the parents are pinned`).toContain(
          parent,
        );
      }
      const report = JSON.stringify(after.slice(0, 8));
      for (const sample of after) {
        expect(
          sample.heading,
          `${title}: a frame lost the heading: ${report}`,
        ).toBeDefined();
        expect(
          Math.abs(sample.heading! - settled.heading!),
          `${title}: a frame painted the heading away from its place: ${report}`,
        ).toBeLessThanOrEqual(TOLERANCE);
        expect(
          sample.heading!,
          `${title}: a frame painted the heading under the sticky bar: ${report}`,
        ).toBeGreaterThanOrEqual(sample.stickyBottom - TOLERANCE);
      }
    }
  } finally {
    writeFileSync(notePath, original);
    await closeBrowser(browser);
  }
}

test("a jump from the Markdown Outline paints the heading at its final place in the first frame, below the sticky bar", async () => {
  test.setTimeout(120_000);
  await expectSteadyJumps(NOTE, JUMPS);
});

test("a jump to a section right under the note's first heading is as steady", async () => {
  test.setTimeout(120_000);
  await expectSteadyJumps(NEAR_TOP_NOTE, NEAR_TOP_JUMPS);
});
