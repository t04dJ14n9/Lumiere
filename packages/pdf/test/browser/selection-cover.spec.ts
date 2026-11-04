/**
 * Text selection must cover glyphs (vertical + horizontal), bullets, and work
 * on dark paper. Synthetic selection-cover.pdf only — never vault content.
 *
 * Root cause class: EmbedPDF SelectionLayer uses multiply + isolation; on dark
 * paper multiply only paints over light ink so boxes look short/shifted.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { send } from "./view-controls-support";
import { lastSelection, open, pagePoint, selectText } from "./viewer-support";

type SelectionCover = {
  size: { width: number; height: number };
  title: { text: string; y: number; size: number; x: number };
  body: ReadonlyArray<{ text: string; y: number; size: number; x: number }>;
  bullets: ReadonlyArray<{
    mark: readonly [number, number, number, number];
    text: string;
    textX: number;
    y: number;
    size: number;
  }>;
};

async function loadCover(): Promise<SelectionCover> {
  const fixtures = pathToFileURL(
    path.join(__dirname, "..", "fixtures", "make-fixtures.mjs"),
  ).href;
  return ((await import(fixtures)) as { SELECTION_COVER: SelectionCover })
    .SELECTION_COVER;
}

async function selectionBlendMode(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const wrapper = document.querySelector<HTMLElement>(
      '.page [style*="isolation"]',
    );
    return wrapper ? getComputedStyle(wrapper).mixBlendMode : null;
  });
}

/**
 * Composite the page (images + selection overlays) onto a canvas and return
 * the fraction of pixels in `rect` (PDF points) that differ from paper by more
 * than `delta` in any channel — catches multiply shortfall on dark paper.
 */
async function paintedCoverage(
  page: Page,
  rect: { left: number; top: number; right: number; bottom: number },
  paper: { r: number; g: number; b: number },
  delta = 18,
): Promise<number> {
  return page.evaluate(
    ({ rect, paper, delta }) => {
      const pageEl = document.querySelector<HTMLElement>(
        '.page[data-page-index="0"]',
      );
      if (!pageEl) {
        return 0;
      }
      const pageBox = pageEl.getBoundingClientRect();
      const scale = pageBox.width / 300;
      const width = Math.max(1, Math.round(pageBox.width));
      const height = Math.max(1, Math.round(pageBox.height));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        return 0;
      }
      ctx.fillStyle = `rgb(${paper.r},${paper.g},${paper.b})`;
      ctx.fillRect(0, 0, width, height);
      for (const img of pageEl.querySelectorAll("img")) {
        const r = img.getBoundingClientRect();
        if (img.complete && img.naturalWidth > 0) {
          ctx.drawImage(
            img,
            r.left - pageBox.left,
            r.top - pageBox.top,
            r.width,
            r.height,
          );
        }
      }
      // Selection wrappers: honour computed mix-blend-mode when painting.
      for (const wrapper of pageEl.querySelectorAll<HTMLElement>(
        '[style*="isolation"]',
      )) {
        const blend = getComputedStyle(wrapper).mixBlendMode || "normal";
        for (const child of wrapper.children) {
          const c = child as HTMLElement;
          const cBox = c.getBoundingClientRect();
          const fill = getComputedStyle(c).backgroundColor;
          if (!fill || fill === "rgba(0, 0, 0, 0)") {
            continue;
          }
          const x = cBox.left - pageBox.left;
          const y = cBox.top - pageBox.top;
          const w = cBox.width;
          const h = cBox.height;
          if (blend === "multiply") {
            // Simulate multiply: for each pixel, result = src * dst / 255.
            const snap = ctx.getImageData(
              Math.max(0, Math.floor(x)),
              Math.max(0, Math.floor(y)),
              Math.max(1, Math.ceil(w)),
              Math.max(1, Math.ceil(h)),
            );
            const parse = fill.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
            const [sr, sg, sb] = parse;
            for (let i = 0; i < snap.data.length; i += 4) {
              snap.data[i] = Math.round((snap.data[i]! * sr!) / 255);
              snap.data[i + 1] = Math.round((snap.data[i + 1]! * sg!) / 255);
              snap.data[i + 2] = Math.round((snap.data[i + 2]! * sb!) / 255);
            }
            ctx.putImageData(
              snap,
              Math.max(0, Math.floor(x)),
              Math.max(0, Math.floor(y)),
            );
          } else {
            ctx.fillStyle = fill;
            ctx.fillRect(x, y, w, h);
          }
        }
      }
      const left = Math.round(rect.left * scale);
      const top = Math.round(rect.top * scale);
      const rw = Math.max(1, Math.round((rect.right - rect.left) * scale));
      const rh = Math.max(1, Math.round((rect.bottom - rect.top) * scale));
      const data = ctx.getImageData(left, top, rw, rh).data;
      let hit = 0;
      const total = rw * rh;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i]! - paper.r) > delta ||
          Math.abs(data[i + 1]! - paper.g) > delta ||
          Math.abs(data[i + 2]! - paper.b) > delta
        ) {
          hit += 1;
        }
      }
      return total === 0 ? 0 : hit / total;
    },
    { rect, paper, delta },
  );
}

/** Vertical span of tinted pixels at a PDF x through [top,bottom], in PDF points. */
async function verticalTintSpan(
  page: Page,
  x: number,
  top: number,
  bottom: number,
  paper: { r: number; g: number; b: number },
  delta = 18,
): Promise<number> {
  const coverageRows = await page.evaluate(
    ({ x, top, bottom, paper, delta }) => {
      const pageEl = document.querySelector<HTMLElement>(
        '.page[data-page-index="0"]',
      );
      if (!pageEl) {
        return [] as boolean[];
      }
      const pageBox = pageEl.getBoundingClientRect();
      const scale = pageBox.width / 300;
      const width = Math.max(1, Math.round(pageBox.width));
      const height = Math.max(1, Math.round(pageBox.height));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        return [] as boolean[];
      }
      ctx.fillStyle = `rgb(${paper.r},${paper.g},${paper.b})`;
      ctx.fillRect(0, 0, width, height);
      for (const img of pageEl.querySelectorAll("img")) {
        const r = img.getBoundingClientRect();
        if (img.complete && img.naturalWidth > 0) {
          ctx.drawImage(
            img,
            r.left - pageBox.left,
            r.top - pageBox.top,
            r.width,
            r.height,
          );
        }
      }
      for (const wrapper of pageEl.querySelectorAll<HTMLElement>(
        '[style*="isolation"]',
      )) {
        const blend = getComputedStyle(wrapper).mixBlendMode || "normal";
        for (const child of wrapper.children) {
          const c = child as HTMLElement;
          const cBox = c.getBoundingClientRect();
          const fill = getComputedStyle(c).backgroundColor;
          if (!fill || fill === "rgba(0, 0, 0, 0)") {
            continue;
          }
          const cx = cBox.left - pageBox.left;
          const cy = cBox.top - pageBox.top;
          const cw = cBox.width;
          const ch = cBox.height;
          if (blend === "multiply") {
            const snap = ctx.getImageData(
              Math.max(0, Math.floor(cx)),
              Math.max(0, Math.floor(cy)),
              Math.max(1, Math.ceil(cw)),
              Math.max(1, Math.ceil(ch)),
            );
            const parse = fill.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
            const [sr, sg, sb] = parse;
            for (let i = 0; i < snap.data.length; i += 4) {
              snap.data[i] = Math.round((snap.data[i]! * sr!) / 255);
              snap.data[i + 1] = Math.round((snap.data[i + 1]! * sg!) / 255);
              snap.data[i + 2] = Math.round((snap.data[i + 2]! * sb!) / 255);
            }
            ctx.putImageData(
              snap,
              Math.max(0, Math.floor(cx)),
              Math.max(0, Math.floor(cy)),
            );
          } else {
            ctx.fillStyle = fill;
            ctx.fillRect(cx, cy, cw, ch);
          }
        }
      }
      const px = Math.round(x * scale);
      const y0 = Math.round(top * scale);
      const y1 = Math.round(bottom * scale);
      const rows: boolean[] = [];
      for (let y = y0; y <= y1; y += 1) {
        const [r, g, b] = ctx.getImageData(px, y, 1, 1).data;
        rows.push(
          Math.abs(r! - paper.r) > delta ||
            Math.abs(g! - paper.g) > delta ||
            Math.abs(b! - paper.b) > delta,
        );
      }
      return rows;
    },
    { x, top, bottom, paper, delta },
  );
  let first = -1;
  let last = -1;
  for (let i = 0; i < coverageRows.length; i += 1) {
    if (coverageRows[i]) {
      if (first < 0) {
        first = i;
      }
      last = i;
    }
  }
  if (first < 0) {
    return 0;
  }
  // Convert pixel span back to PDF points (page height 400 / canvas height).
  const pageBox = await page
    .locator('.page[data-page-index="0"]')
    .boundingBox();
  const scale = (pageBox?.width ?? 300) / 300;
  return (last - first + 1) / scale;
}

/** Horizontal span of tint along a midline, in PDF points. */
async function horizontalTintSpan(
  page: Page,
  y: number,
  left: number,
  right: number,
  paper: { r: number; g: number; b: number },
  delta = 18,
): Promise<number> {
  const cols = await page.evaluate(
    ({ y, left, right, paper, delta }) => {
      const pageEl = document.querySelector<HTMLElement>(
        '.page[data-page-index="0"]',
      );
      if (!pageEl) {
        return [] as boolean[];
      }
      const pageBox = pageEl.getBoundingClientRect();
      const scale = pageBox.width / 300;
      const width = Math.max(1, Math.round(pageBox.width));
      const height = Math.max(1, Math.round(pageBox.height));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        return [] as boolean[];
      }
      ctx.fillStyle = `rgb(${paper.r},${paper.g},${paper.b})`;
      ctx.fillRect(0, 0, width, height);
      for (const img of pageEl.querySelectorAll("img")) {
        const r = img.getBoundingClientRect();
        if (img.complete && img.naturalWidth > 0) {
          ctx.drawImage(
            img,
            r.left - pageBox.left,
            r.top - pageBox.top,
            r.width,
            r.height,
          );
        }
      }
      for (const wrapper of pageEl.querySelectorAll<HTMLElement>(
        '[style*="isolation"]',
      )) {
        const blend = getComputedStyle(wrapper).mixBlendMode || "normal";
        for (const child of wrapper.children) {
          const c = child as HTMLElement;
          const cBox = c.getBoundingClientRect();
          const fill = getComputedStyle(c).backgroundColor;
          if (!fill || fill === "rgba(0, 0, 0, 0)") {
            continue;
          }
          const cx = cBox.left - pageBox.left;
          const cy = cBox.top - pageBox.top;
          const cw = cBox.width;
          const ch = cBox.height;
          if (blend === "multiply") {
            const snap = ctx.getImageData(
              Math.max(0, Math.floor(cx)),
              Math.max(0, Math.floor(cy)),
              Math.max(1, Math.ceil(cw)),
              Math.max(1, Math.ceil(ch)),
            );
            const parse = fill.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
            const [sr, sg, sb] = parse;
            for (let i = 0; i < snap.data.length; i += 4) {
              snap.data[i] = Math.round((snap.data[i]! * sr!) / 255);
              snap.data[i + 1] = Math.round((snap.data[i + 1]! * sg!) / 255);
              snap.data[i + 2] = Math.round((snap.data[i + 2]! * sb!) / 255);
            }
            ctx.putImageData(
              snap,
              Math.max(0, Math.floor(cx)),
              Math.max(0, Math.floor(cy)),
            );
          } else {
            ctx.fillStyle = fill;
            ctx.fillRect(cx, cy, cw, ch);
          }
        }
      }
      const py = Math.round(y * scale);
      const x0 = Math.round(left * scale);
      const x1 = Math.round(right * scale);
      const out: boolean[] = [];
      for (let x = x0; x <= x1; x += 1) {
        const [r, g, b] = ctx.getImageData(x, py, 1, 1).data;
        out.push(
          Math.abs(r! - paper.r) > delta ||
            Math.abs(g! - paper.g) > delta ||
            Math.abs(b! - paper.b) > delta,
        );
      }
      return out;
    },
    { y, left, right, paper, delta },
  );
  let first = -1;
  let last = -1;
  for (let i = 0; i < cols.length; i += 1) {
    if (cols[i]) {
      if (first < 0) {
        first = i;
      }
      last = i;
    }
  }
  if (first < 0) {
    return 0;
  }
  const pageBox = await page
    .locator('.page[data-page-index="0"]')
    .boundingBox();
  const scale = (pageBox?.width ?? 300) / 300;
  return (last - first + 1) / scale;
}

const DARK_PAPER = { r: 30, g: 30, b: 30 };
const LIGHT_PAPER = { r: 255, g: 255, b: 255 };

async function selectCoverRange(page: Page, cover: SelectionCover) {
  const at = await pagePoint(page, 1);
  // Down the text column, then along the last bullet label so its full run is in.
  const x = cover.body[0]!.x + 24;
  const from = at(x, cover.title.y - cover.title.size * 0.4);
  const lastBullet = cover.bullets[cover.bullets.length - 1]!;
  const midLast = at(x, lastBullet.y - lastBullet.size * 0.35);
  const endLast = at(
    lastBullet.textX + 150,
    lastBullet.y - lastBullet.size * 0.35,
  );
  let nudge = 0;
  await expect
    .poll(async () => {
      nudge = 1 - nudge;
      await page.mouse.move(from[0] + nudge, from[1]);
      return page.evaluate(
        ([x, y]) =>
          getComputedStyle(document.elementFromPoint(x, y) as Element).cursor,
        from,
      );
    })
    .toBe("text");
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...midLast, { steps: 50 });
  await page.mouse.move(...endLast, { steps: 15 });
  await page.mouse.up();
}

async function selectBulletLine(
  page: Page,
  cover: SelectionCover,
  index: number,
) {
  const at = await pagePoint(page, 1);
  const bullet = cover.bullets[index]!;
  const y = bullet.y - bullet.size * 0.35;
  await selectText(page, at(bullet.textX + 2, y), at(bullet.textX + 150, y));
}

test("dark paper: selection blend is normal and boxes cover glyphs + bullets", async ({
  page,
}) => {
  const cover = await loadCover();
  await open(page, "?pdf=selection-cover.pdf");
  // Select on light paper first (text layout is settled), then switch to dark —
  // matches the visual bug and avoids drag races while the dark picture swaps.
  await selectCoverRange(page, cover);
  await expect.poll(() => lastSelection(page)).toMatchObject({ kind: "text" });
  const selection = (await lastSelection(page)) as {
    kind: string;
    text: string;
  };
  expect(selection.text).toContain("Dynamic Composability");
  expect(selection.text).toContain("Temporal composability");
  expect(selection.text.toLowerCase()).toContain("gypsy");
  // Spatial may need the along-line finish; accept either full range or follow-up.
  if (!selection.text.includes("Spatial composability")) {
    await page.keyboard.press("Escape");
    await selectBulletLine(page, cover, 1);
    await expect
      .poll(async () => {
        const next = (await lastSelection(page)) as { text?: string } | null;
        return next?.text ?? "";
      })
      .toContain("Spatial composability");
    // Re-select the multi-line range for coverage asserts below.
    await page.keyboard.press("Escape");
    await selectCoverRange(page, cover);
    await expect
      .poll(() => lastSelection(page))
      .toMatchObject({ kind: "text" });
  } else {
    expect(selection.text).toContain("Spatial composability");
  }

  await send(page, { type: "pageColors", effective: "dark" });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".page[data-page-index]")!)
            .backgroundColor,
      ),
    )
    .toBe("rgb(30, 30, 30)");
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const img = document.querySelector<HTMLImageElement>(
          ".page img.page-image:not(.page-image-low)",
        );
        return Boolean(img?.complete && img.naturalWidth > 0);
      });
    })
    .toBe(true);
  // Selection must still be painted after the paper switch.
  await expect.poll(() => selectionBlendMode(page)).toBe("normal");

  // Vertical: descender line must show tint across ~full selection box height,
  // not only the ink band (multiply shortfall).
  const gypsy = cover.body[2]!;
  const vSpan = await verticalTintSpan(
    page,
    gypsy.x + 120,
    gypsy.y - gypsy.size,
    gypsy.y + gypsy.size * 0.35,
    DARK_PAPER,
  );
  expect(vSpan, "vertical tint over descender line").toBeGreaterThan(
    gypsy.size * 0.85,
  );

  // Horizontal: continuous band across the title, not letter-ink speckles.
  const hSpan = await horizontalTintSpan(
    page,
    cover.title.y - cover.title.size * 0.35,
    cover.title.x,
    cover.title.x + 200,
    DARK_PAPER,
  );
  expect(hSpan, "horizontal tint over title").toBeGreaterThan(160);

  // Bullet label line: coverage includes the label text run.
  const bullet = cover.bullets[0]!;
  const bulletCoverage = await paintedCoverage(
    page,
    {
      left: bullet.textX,
      top: bullet.y - bullet.size,
      right: bullet.textX + 140,
      bottom: bullet.y + 2,
    },
    DARK_PAPER,
  );
  expect(bulletCoverage, "bullet label selection coverage").toBeGreaterThan(
    0.55,
  );
});

test("light paper: selection still covers multi-line body (multiply OK on white)", async ({
  page,
}) => {
  const cover = await loadCover();
  await open(page, "?pdf=selection-cover.pdf");
  await selectCoverRange(page, cover);
  await expect.poll(() => lastSelection(page)).toMatchObject({ kind: "text" });
  expect(await selectionBlendMode(page)).toBe("multiply");
  const gypsy = cover.body[2]!;
  const vSpan = await verticalTintSpan(
    page,
    gypsy.x + 120,
    gypsy.y - gypsy.size,
    gypsy.y + gypsy.size * 0.35,
    LIGHT_PAPER,
  );
  expect(vSpan, "light paper vertical tint").toBeGreaterThan(gypsy.size * 0.85);
});
