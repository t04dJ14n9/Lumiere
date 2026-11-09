import { expect, test, type Page } from "@playwright/test";
import {
  open,
  openWithRegions,
  pagePoint,
  selectText,
  drag,
  TEXT_MIDLINE,
} from "./viewer-support";
import { send } from "./view-controls-support";

const THEMES = {
  "Light Modern": {
    "editor-selectionBackground": "#ADD6FF",
    "textLink-foreground": "#005FB8",
    focusBorder: "#005FB8",
  },
  "Dark Modern": {
    "editor-selectionBackground": "#264F78",
    "textLink-foreground": "#4daafc",
    focusBorder: "#0078D4",
  },
  "Dark High Contrast": {
    "editor-selectionBackground": "#f3f518",
    "textLink-foreground": "#21A6FF",
    focusBorder: "#F38518",
  },
  "Light High Contrast": {
    "editor-selectionBackground": "#0F4A85",
    "textLink-foreground": "#0F4A85",
    focusBorder: "#006BBD",
  },
  "Cursor Light": {
    "editor-selectionBackground": "rgba(20, 20, 20, 0.08)",
    "textLink-foreground": "#0064B0",
    focusBorder: "rgba(20, 20, 20, 0.2)",
  },
  "Cursor Dark": {
    "editor-selectionBackground": "rgba(64, 64, 64, 0.6)",
    "textLink-foreground": "#81A1C1",
    focusBorder: "rgba(240, 240, 240, 0.15)",
  },
};

async function useTheme(
  page: Page,
  colours: Record<string, string>,
): Promise<void> {
  await page.evaluate((colours) => {
    for (const [name, value] of Object.entries(colours)) {
      document.documentElement.style.setProperty(`--vscode-${name}`, value);
    }
  }, colours);
}

/**
 * How a colour on `element` stands out from the white page beneath it: the
 * WCAG contrast ratio between white and the colour painted over white.
 */
function contrastOnPaper(
  page: Page,
  selector: string,
  property: "backgroundColor" | "borderTopColor" | "fill",
): Promise<number> {
  return page.evaluate(
    ([selector, property]) => {
      const colour = getComputedStyle(document.querySelector(selector)!)[
        property
      ];
      const context = Object.assign(document.createElement("canvas"), {
        width: 1,
        height: 1,
      }).getContext("2d")!;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = colour;
      context.fillRect(0, 0, 1, 1);
      const channels = [
        ...context.getImageData(0, 0, 1, 1).data.slice(0, 3),
      ].map((value) => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      const luminance =
        0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
      return 1.05 / (luminance + 0.05);
    },
    [selector, property] as const,
  );
}

test("selections and flashed boxes stand out on the page in every theme", async ({
  page,
}) => {
  await openWithRegions(page);
  const at = await pagePoint(page, 1);
  await selectText(page, at(74, TEXT_MIDLINE), at(205, TEXT_MIDLINE));
  const fills: Record<string, number> = {};
  for (const [name, colours] of Object.entries(THEMES)) {
    await useTheme(page, colours);
    // EmbedPDF draws the selection as polygons filled with its own variable,
    // which base.css sets to the viewer's `--selection-fill`.
    fills[name] = await contrastOnPaper(
      page,
      'polygon[style*="epdf-text-selection"]',
      "fill",
    );
  }

  await page.keyboard.press("Escape");
  await drag(page, at(150, 150), at(250, 250));
  await expect(page.locator(".region-selection")).toBeVisible();
  const regions: Record<string, number[]> = {};
  for (const [name, colours] of Object.entries(THEMES)) {
    await useTheme(page, colours);
    regions[name] = [
      await contrastOnPaper(page, ".region-selection", "backgroundColor"),
      await contrastOnPaper(page, ".region-selection", "borderTopColor"),
    ];
  }

  await page.evaluate(() =>
    (window as unknown as { hostSend: (message: unknown) => void }).hostSend({
      type: "goTo",
      location: {
        page: 1,
        viewRect: { left: 72, top: 83, width: 134, height: 21 },
      },
    }),
  );
  await expect(page.locator(".location-highlight")).toBeVisible();
  const flashes: Record<string, number> = {};
  for (const [name, colours] of Object.entries(THEMES)) {
    await useTheme(page, colours);
    flashes[name] = await contrastOnPaper(
      page,
      ".location-highlight",
      "borderTopColor",
    );
  }

  for (const name of Object.keys(THEMES)) {
    // A highlight under text: clearly tinted, yet light enough to read through.
    expect(fills[name], `${name} text selection`).toBeGreaterThan(1.3);
    expect(regions[name]![0], `${name} region fill`).toBeGreaterThan(1.1);
    // Outlines: WCAG's 3:1 for graphical objects.
    expect(regions[name]![1], `${name} region border`).toBeGreaterThanOrEqual(
      3,
    );
    expect(flashes[name], `${name} location border`).toBeGreaterThanOrEqual(3);
  }
});

// While a page waits for its picture (a fast scroll outruns the renderer), its
// box is all that shows: it must be the paper of the current page colors, not
// white on dark paper. The Stage paints that box, around Lumiere's `.page`.
test("a page with no picture yet shows the paper of the page colors", async ({
  page,
}) => {
  await open(page);
  const paper = () =>
    page.evaluate(() => {
      const box = document.querySelector<HTMLElement>(
        ".page[data-page-index]",
      )?.parentElement;
      return box ? getComputedStyle(box).backgroundColor : undefined;
    });
  expect(await paper()).toBe("rgb(255, 255, 255)");
  await send(page, { type: "pageColors", effective: "dark" });
  await expect.poll(paper).toBe("rgb(30, 30, 30)");
  await send(page, { type: "pageColors", effective: "normal" });
  await expect.poll(paper).toBe("rgb(255, 255, 255)");
});

/**
 * How far apart the lightest and darkest pixels of the selected line are, from
 * 0 (one flat colour) to 1: the text under the selection must still show.
 */
async function textShowsThrough(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
): Promise<number> {
  const png = (await page.screenshot({ clip: box })).toString("base64");
  return page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = Object.assign(document.createElement("canvas"), {
      width: image.width,
      height: image.height,
    });
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    let lightest = 0;
    let darkest = 1;
    for (let i = 0; i < data.length; i += 4) {
      const l =
        (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) /
        255;
      lightest = Math.max(lightest, l);
      darkest = Math.min(darkest, l);
    }
    return lightest - darkest;
  }, png);
}

for (const colors of ["normal", "dark"] as const) {
  test(`selected text stays readable through the selection on ${colors} paper`, async ({
    page,
  }) => {
    await open(page);
    if (colors === "dark") {
      await send(page, { type: "pageColors", effective: "dark" });
    }
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLImageElement>(".page img")].some(
            (image) => image.naturalWidth > 0,
          ),
        ),
      )
      .toBe(true);
    const at = await pagePoint(page, 1);
    await selectText(page, at(74, TEXT_MIDLINE), at(205, TEXT_MIDLINE));
    const line = page.locator('polygon[style*="epdf-text-selection"]').first();
    await expect(line).toBeVisible();
    const box = (await line.boundingBox())!;
    // Inside the selected line only: glyphs and the fill must both show.
    const inside = {
      x: box.x + 2,
      y: box.y + 2,
      width: box.width - 4,
      height: box.height - 4,
    };
    expect(await textShowsThrough(page, inside)).toBeGreaterThan(0.35);
  });
}
