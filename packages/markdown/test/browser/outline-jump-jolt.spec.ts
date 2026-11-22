import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { open } from "./harness";

/**
 * A jump to a heading whose parents are pinned by the sticky bar only once
 * the jump has scrolled (the bar was empty at the top of the note). The first
 * painted frame must already have the heading where it settles, below the
 * bar: a frame with the heading under the bar, then a shift by the bar's
 * height, is a flicker on every Outline click.
 */

/** How far a painted frame may be from where the heading settles. */
const TOLERANCE = 2;

/**
 * Eight chapters of two sections each, so every jump has a parent to pin, and
 * the first section of each has a subsection: two parents.
 */
function longNote(): string {
  const parts: string[] = [];
  const body = (name: string) => {
    for (let line = 1; line <= 12; line++) {
      parts.push(`Body of ${name}, line ${line}.`, "");
    }
  };
  for (let chapter = 1; chapter <= 8; chapter++) {
    parts.push(`# Chapter ${chapter}`, "");
    for (let section = 1; section <= 2; section++) {
      parts.push(`## Section ${chapter}.${section}`, "");
      parts.push("```js\nconst a = 1;\nconsole.log(a);\n```", "");
      body(`section ${chapter}.${section}`);
      if (section === 1) {
        parts.push(`### Sub ${chapter}.1.1`, "");
        body(`sub ${chapter}.1.1`);
      }
    }
  }
  parts.push("## Last", "", "The end.");
  return parts.join("\n");
}

async function openWithSticky(page: Page, source: string) {
  await open(page, source, "obsidian", {
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
}

interface Frame {
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
async function recordFrames(
  page: Page,
  title: string,
  jump: () => Promise<unknown>,
): Promise<{ before: number; frames: Frame[] }> {
  const before = await page.evaluate(
    () => document.querySelector(".cm-scroller")!.scrollTop,
  );
  await page.evaluate((title) => {
    const scroller = document.querySelector<HTMLElement>(".cm-scroller")!;
    const frames: Frame[] = [];
    const store = window as unknown as {
      __frames: { frames: Frame[]; stop: () => void };
    };
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
      frames.push({
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
    store.__frames = {
      frames,
      stop: () => {
        stopped = true;
        observer.disconnect();
        probe.remove();
      },
    };
  }, title);
  await jump();
  // Long enough for the held jump to settle.
  await page.waitForTimeout(1500);
  const frames = await page.evaluate(() => {
    const store = window as unknown as {
      __frames: { frames: Frame[]; stop: () => void };
    };
    store.__frames.stop();
    return store.__frames.frames;
  });
  return { before, frames };
}

/** Each jump with the headings the sticky bar pins above it once it lands. */
const JUMPS: Array<{ heading: string; parents?: string[] }> = [
  { heading: "## Section 4.1", parents: ["Chapter 4"] },
  { heading: "### Sub 5.1.1", parents: ["Chapter 5", "Section 5.1"] },
  // Out of a bar of two rows, into one of one row.
  { heading: "## Section 2.2", parents: ["Chapter 2"] },
  // Out of a bar, into a heading with none.
  { heading: "# Chapter 6", parents: [] },
  // Right under the first chapter, where the note's start leaves little to scroll.
  { heading: "## Section 1.1", parents: ["Chapter 1"] },
  // The end of the note cannot scroll far enough to put its last heading
  // first: it stays where the note ends, and the bar pins what is above it.
  { heading: "## Last" },
];

test("a jump paints its heading at its final place in the first frame, below the sticky bar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  const source = longNote();
  await openWithSticky(page, source);
  for (const { heading, parents } of JUMPS) {
    const title = heading.replace(/^#+ /, "");
    const { before, frames } = await recordFrames(page, title, () =>
      page.evaluate(
        (at) => window.harness.navigate({ fragment: "", at }),
        source.indexOf(`\n${heading}\n`) + 1,
      ),
    );
    const jumped = frames.findIndex((frame) => frame.scrollTop !== before);
    expect(jumped, `${title}: the jump scrolled`).toBeGreaterThanOrEqual(0);
    const after = frames.slice(jumped);
    const settled = after.at(-1)!;
    expect(settled.heading, `${title}: landed`).toBeDefined();
    for (const parent of parents ?? []) {
      expect(settled.sticky, `${title}: the parents are pinned`).toContain(
        parent,
      );
    }
    if (parents?.length === 0) {
      expect(settled.sticky, `${title}: nothing is pinned`).toBe("");
    }
    const report = JSON.stringify(after.slice(0, 8));
    for (const frame of after) {
      expect(
        frame.heading,
        `${title}: a frame lost the heading: ${report}`,
      ).toBeDefined();
      expect(
        Math.abs(frame.heading! - settled.heading!),
        `${title}: a frame painted the heading away from its place: ${report}`,
      ).toBeLessThanOrEqual(TOLERANCE);
      expect(
        frame.heading!,
        `${title}: a frame painted the heading under the sticky bar: ${report}`,
      ).toBeGreaterThanOrEqual(frame.stickyBottom - TOLERANCE);
    }
  }
});
