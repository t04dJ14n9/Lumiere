import { test, expect, chromium } from "@playwright/test";
import type { Frame, Page } from "@playwright/test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { paths, readState } from "./state";
import {
  closeBrowser,
  command,
  openWorkbench,
  workbenchPage,
} from "./workbench";

/**
 * A jump from the Markdown Outline to a heading right under an image the
 * jump is the first to show. The image is laid out at its size before its
 * load event has CodeMirror measure it, and the frame in between used to be
 * painted with the note pushed down by the image's height (another part of
 * the note on screen), then a frame with the sticky bar showing the section
 * above the heading. Frames are sampled where the browser is about to paint
 * them: in a resize observer, which runs after layout and before paint.
 */

const SECTIONS = 6;
/** How far the heading may be from where it ends, once it has landed. */
const TOLERANCE = 40;

/**
 * A PNG of noise, `height` px tall. Its header, and so its size, arrives
 * long before the rest of it has loaded and decoded: noise does not compress.
 */
function png(height: number): Buffer {
  const width = 1200;
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Array.from({ length: height }, () =>
    Buffer.concat([Buffer.from([0]), randomBytes(width * 3)]),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Each section ends with an image of its own, so each jump loads one. */
function note(): string {
  const sections = Array.from({ length: SECTIONS }, (_, n) =>
    [
      `## Section ${n}`,
      `Paragraph ${n} ` + "lorem ipsum dolor sit amet ".repeat(40),
      "| a | b |\n| - | - |\n" +
        Array.from({ length: 6 }, (_, r) => `| ${r} | x${r} |`).join("\n"),
      "```ts\n" +
        Array.from({ length: 10 }, (_, r) => `const v${r} = ${r};`).join("\n") +
        "\n```",
      `![[flash-${n}.png]]`,
    ].join("\n\n"),
  );
  return ["# Heavy", ...sections].join("\n\n");
}

async function editorFrame(page: Page): Promise<Frame> {
  for (const frame of page.frames()) {
    if (await frame.locator(".cm-line").count()) {
      return frame;
    }
  }
  throw new Error("No Lumiere frame");
}

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

interface Sample {
  scrollTop: number;
  /** The target heading's text, in px below the top of the scroller. */
  heading: number | undefined;
  sticky: string;
}

/**
 * Start sampling the frame: one sample per resize of the content once the
 * jump has scrolled, the observer created then so it runs after the
 * editor's own (resize observers run in the order they were made).
 */
async function watchJump(frame: Frame, title: string) {
  await frame.evaluate((title) => {
    const scroller = document.querySelector<HTMLElement>(".cm-scroller")!;
    const content = document.querySelector(".cm-content")!;
    const store = window as unknown as {
      __jump: { samples: Sample[]; stop: () => void };
    };
    const samples: Sample[] = [];
    const start = scroller.scrollTop;
    let observer: ResizeObserver | undefined;
    let stopped = false;
    const sample = () => {
      const top = scroller.getBoundingClientRect().top;
      const line = [...document.querySelectorAll(".cm-line")].find(
        (candidate) => candidate.textContent?.replace(/^#+ /, "") === title,
      );
      const sticky = document.querySelector<HTMLElement>(".mw-sticky-scroll");
      samples.push({
        scrollTop: scroller.scrollTop,
        heading: line ? line.getBoundingClientRect().top - top : undefined,
        sticky: sticky && !sticky.hidden ? (sticky.textContent ?? "") : "",
      });
    };
    const arm = () => {
      if (stopped) {
        return;
      }
      if (scroller.scrollTop === start) {
        requestAnimationFrame(arm);
        return;
      }
      sample();
      observer = new ResizeObserver(sample);
      observer.observe(content);
    };
    requestAnimationFrame(arm);
    store.__jump = {
      samples,
      stop: () => {
        stopped = true;
        observer?.disconnect();
      },
    };
  }, title);
  return () =>
    frame.evaluate(() => {
      const store = window as unknown as {
        __jump: { samples: Sample[]; stop: () => void };
      };
      store.__jump.stop();
      return store.__jump.samples;
    });
}

test("a jump from the Markdown Outline to a heading under a loading image paints no other part of the note", async () => {
  const notePath = path.join(paths.workspace, "Note.md");
  const original = readFileSync(notePath, "utf8");
  const images = Array.from({ length: SECTIONS }, (_, n) =>
    path.join(paths.workspace, `flash-${n}.png`),
  );
  images.forEach((image, n) => writeFileSync(image, png(300 + 100 * n)));
  writeFileSync(notePath, note());
  const browser = await chromium.connectOverCDP(readState().webSocket);
  try {
    const page = workbenchPage(browser);
    await openWorkbench(page);
    await command(page, "View: Show Explorer");
    // A toast left by an earlier spec can cover the Outline's header.
    await command(page, "Notifications: Clear All Notifications");
    const tab = page.locator(".tabs-container .tab.active");
    for (const target of [5, 1, 4, 2, 3]) {
      const title = `Section ${target}`;
      const frame = await editorFrame(page);
      const before = await frame.evaluate(
        () => document.querySelector(".cm-scroller")!.scrollTop,
      );
      const stop = await watchJump(frame, title);
      await clickOutline(page, title);
      // Long enough for the image above the heading to load and settle.
      await page.waitForTimeout(1500);
      const samples = await stop();
      const settled = samples.at(-1);
      expect(settled?.heading, `${title}: landed`).toBeDefined();
      for (const sample of samples) {
        expect(
          Math.abs((sample.heading ?? Infinity) - settled!.heading!),
          `${title}: a frame painted away from the heading: ${JSON.stringify(samples)}`,
        ).toBeLessThanOrEqual(TOLERANCE);
        // Only "Heavy", the heading's parent, belongs in the bar.
        expect(
          sample.sticky,
          `${title}: the sticky bar showed another section`,
        ).not.toMatch(/Section/);
        if (before > 0) {
          expect(sample.scrollTop, `${title}: passed the top`).toBeGreaterThan(
            0,
          );
        }
      }
      // The jump stays in the note's own editor: no other tab or editor.
      await expect(tab).toHaveCount(1);
      await expect(tab).toContainText("Note.md");
      await expect(page.locator(".tabs-container .tab")).toHaveCount(1);
    }
  } finally {
    writeFileSync(notePath, original);
    for (const image of images) {
      rmSync(image, { force: true });
    }
    await closeBrowser(browser);
  }
});
