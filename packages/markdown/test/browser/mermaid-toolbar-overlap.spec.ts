/**
 * Inspect, Copy and Edit are pinned to the visible top-right of a rendered
 * diagram. They must have a reserved lane and never cover Mermaid node text
 * or hit targets, at any horizontal scroll position.
 *
 * Fixtures are generic (Start → Intake → …). Do not use real user diagrams.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { open } from "./harness";

const WIDE_FLOW = `flowchart LR
  start([Start]) --> intake[Intake request]
  intake --> review[Review the draft]
  review --> approve[Approve the change]
  approve --> publish[Publish the note]
  publish --> archive[Archive the source]
  archive --> notify[Notify the readers]
  notify --> done([Done])`;

const NORMAL_FLOW = `flowchart LR
  start([Start]) --> done([Done])`;

const SECOND_WIDE = `flowchart LR
  alpha([Alpha]) --> bravo[Bravo step]
  bravo --> charlie[Charlie step]
  charlie --> delta[Delta step]
  delta --> echo[Echo step]
  echo --> foxtrot[Foxtrot step]
  foxtrot --> golf[Golf step]
  golf --> hotel([Hotel])`;

const NOTE = `# Diagram toolbar

A short diagram:

\`\`\`mermaid
${NORMAL_FLOW}
\`\`\`

A wide pipeline:

\`\`\`mermaid
${WIDE_FLOW}
\`\`\`

A second wide pipeline, consecutively:

\`\`\`mermaid
${SECOND_WIDE}
\`\`\`
`;

const SHOT_DIR =
  process.env.DIAGRAM_TOOLBAR_SHOTS ??
  "/workspace/lumia-diagram-toolbar-20261110/generic-shots";

const SHOT_LABEL = process.env.DIAGRAM_TOOLBAR_SHOT_LABEL ?? "current";

interface ButtonBox {
  name: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface OverlapHit {
  button: string;
  node: string;
}

interface ChromeFit {
  ready: boolean;
  inspectInsidePre: boolean;
  buttonCount: number;
  buttons: ButtonBox[];
  nodeCount: number;
  overlaps: OverlapHit[];
  preClientWidth: number;
  preScrollWidth: number;
  preRight: number;
  laneRight: number;
  scrollerClientWidth: number;
  scrollerScrollWidth: number;
  scrollLeft: number;
}

const SCROLLS = [0, 0.25, 0.5, 0.75, 1] as const;

function mermaidNote(source: string): string {
  return `\`\`\`mermaid\n${source}\n\`\`\`\n\nafter\n`;
}

async function reveal(page: Page, needle: string) {
  await page.evaluate((needle) => {
    window.harness.reveal(window.harness.text.indexOf(needle));
  }, needle);
}

async function waitForDiagram(page: Page, needle: string) {
  await expect
    .poll(async () => (await chromeAt(page, needle)).ready, { timeout: 15000 })
    .toBe(true);
}

async function chromeAt(
  page: Page,
  needle: string,
  scrollFraction?: number,
): Promise<ChromeFit> {
  return page.evaluate(
    ({ needle, scrollFraction }) => {
      const empty = (): ChromeFit => ({
        ready: false,
        inspectInsidePre: false,
        buttonCount: 0,
        buttons: [],
        nodeCount: 0,
        overlaps: [],
        preClientWidth: 0,
        preScrollWidth: 0,
        preRight: 0,
        laneRight: 0,
        scrollerClientWidth: 0,
        scrollerScrollWidth: 0,
        scrollLeft: 0,
      });
      const pre = [
        ...document.querySelectorAll('pre[data-fence="mermaid"]'),
      ].find((item) =>
        decodeURIComponent(item.getAttribute("data-source") || "").includes(
          needle,
        ),
      );
      const svg = pre?.querySelector("svg");
      const scroller = document.querySelector(".cm-scroller");
      const shell = pre?.closest(".hybrid-block");
      if (!pre || !svg || !scroller || !shell || !svg.querySelector(".node")) {
        return empty();
      }
      if (scrollFraction !== undefined) {
        const max = Math.max(0, pre.scrollWidth - pre.clientWidth);
        pre.scrollLeft = max * scrollFraction;
      }
      const buttons = [
        ...shell.querySelectorAll<HTMLElement>(
          ".inspect-diagram, .copy-code, .edit-block, .code-language",
        ),
      ].map((button) => {
        const box = button.getBoundingClientRect();
        return {
          name:
            button.getAttribute("aria-label") ||
            button.textContent?.trim() ||
            button.className,
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
        };
      });
      const hostBox = pre.getBoundingClientRect();
      const slop = 0.5;
      // Only the part still inside the scrollport can be seen or clicked;
      // overflowed layout boxes extend under the reserved lane.
      const nodes = [...svg.querySelectorAll(".node")].flatMap((node) => {
        const box = node.getBoundingClientRect();
        const left = Math.max(box.left, hostBox.left);
        const right = Math.min(box.right, hostBox.right);
        const top = Math.max(box.top, hostBox.top);
        const bottom = Math.min(box.bottom, hostBox.bottom);
        if (right - left <= slop || bottom - top <= slop) {
          return [];
        }
        return [
          {
            label: (node.textContent || "").replace(/\s+/g, " ").trim(),
            left,
            right,
            top,
            bottom,
          },
        ];
      });
      const overlaps: OverlapHit[] = [];
      for (const button of buttons) {
        if (button.width < 1 || button.height < 1) {
          continue;
        }
        for (const node of nodes) {
          if (
            button.right > node.left + slop &&
            button.left < node.right - slop &&
            button.bottom > node.top + slop &&
            button.top < node.bottom - slop
          ) {
            overlaps.push({ button: button.name, node: node.label });
          }
        }
      }
      const inspect = shell.querySelector(".inspect-diagram");
      let laneRight = hostBox.right;
      for (const button of buttons) {
        if (button.right > laneRight) {
          laneRight = button.right;
        }
      }
      return {
        ready: true,
        inspectInsidePre: Boolean(inspect && pre.contains(inspect)),
        buttonCount: buttons.length,
        buttons,
        nodeCount: nodes.length,
        overlaps,
        preClientWidth: pre.clientWidth,
        preScrollWidth: pre.scrollWidth,
        preRight: hostBox.right,
        laneRight,
        scrollerClientWidth: scroller.clientWidth,
        scrollerScrollWidth: scroller.scrollWidth,
        scrollLeft: pre.scrollLeft,
      };
    },
    { needle, scrollFraction },
  );
}

async function assertNoOverlap(
  page: Page,
  needle: string,
  overflowing: boolean,
) {
  for (const fraction of SCROLLS) {
    const fit = await chromeAt(page, needle, fraction);
    expect(fit.ready, needle).toBe(true);
    expect(fit.buttonCount, JSON.stringify(fit)).toBeGreaterThanOrEqual(3);
    expect(fit.nodeCount, JSON.stringify(fit)).toBeGreaterThan(0);
    expect(
      fit.overlaps,
      `overlap at scroll ${fraction} of ${needle}: ${JSON.stringify(fit.overlaps)}`,
    ).toEqual([]);
    expect(fit.inspectInsidePre, "inspect stays outside the scrollport").toBe(
      false,
    );
    expect(fit.scrollerScrollWidth).toBeLessThan(fit.scrollerClientWidth + 48);
    if (overflowing) {
      expect(fit.preScrollWidth).toBeGreaterThan(fit.preClientWidth + 80);
    }
    // The scrollport ends at or before the chrome lane, so content cannot
    // slide under the buttons at this (or any) scroll position.
    expect(fit.preRight).toBeLessThanOrEqual(fit.laneRight + 1);
  }
}

async function shoot(page: Page, name: string) {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: join(SHOT_DIR, `${SHOT_LABEL}-${name}.png`),
    fullPage: false,
  });
}

async function showChrome(page: Page) {
  await page.addStyleTag({
    content: `.hybrid-block .inspect-diagram, .hybrid-block .copy-code, .hybrid-block .edit-block { opacity: 1 !important; }`,
  });
}

test("wide mermaid chrome never covers nodes at any horizontal scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await open(page, mermaidNote(WIDE_FLOW));
  await reveal(page, "after");
  await waitForDiagram(page, "Intake request");
  await showChrome(page);
  await chromeAt(page, "Intake request", 0);
  await shoot(page, "wide-1100-start");
  await chromeAt(page, "Intake request", 1);
  await shoot(page, "wide-1100-scrolled-end");
  await assertNoOverlap(page, "Intake request", true);
});

test("narrow viewports still reserve a non-overlapping chrome lane", async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 720 });
  await open(page, mermaidNote(WIDE_FLOW));
  await reveal(page, "after");
  await waitForDiagram(page, "Intake request");
  await showChrome(page);
  await chromeAt(page, "Intake request", 1);
  await shoot(page, "wide-480-scrolled-end");
  await assertNoOverlap(page, "Intake request", true);
});

test("a short mermaid diagram keeps its buttons off the nodes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await open(page, mermaidNote(NORMAL_FLOW));
  await reveal(page, "after");
  await waitForDiagram(page, "Start");
  await showChrome(page);
  await shoot(page, "normal-1100");
  await assertNoOverlap(page, "Start", false);
});

test("consecutive diagrams each keep a clear chrome lane", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await open(page, NOTE);
  await reveal(page, "A wide pipeline");
  await waitForDiagram(page, "Intake request");
  await waitForDiagram(page, "Bravo step");
  await showChrome(page);
  await assertNoOverlap(page, "Start", false);
  await assertNoOverlap(page, "Intake request", true);
  await chromeAt(page, "Bravo step", 1);
  await shoot(page, "consecutive-second-scrolled-end");
  await assertNoOverlap(page, "Bravo step", true);
});

test("diagram actions stay keyboard-reachable without covering nodes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await open(page, mermaidNote(WIDE_FLOW));
  await reveal(page, "after");
  await waitForDiagram(page, "Intake request");
  await chromeAt(page, "Intake request", 1);
  const labels = [
    "Inspect diagram",
    "Copy code",
    "Edit diagram source",
  ] as const;
  for (const name of labels) {
    const button = page.getByRole("button", { name });
    await expect(button).toBeAttached();
    await button.focus();
    await expect(button).toBeFocused();
  }
  await assertNoOverlap(page, "Intake request", true);
});
