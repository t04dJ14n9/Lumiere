// Diagnostic 4: find genuinely blank page points (no link overlay, not over text).
import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:19239";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
const page = await context.newPage();
const view = encodeURIComponent(
  JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }),
);
await page.goto(`${BASE}/?toolbar=slim&view=${view}`);
await page.locator(".page img").first().waitFor({ state: "visible" });
await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
await page.waitForTimeout(300);

console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const box = document.querySelector('.page[data-page-index="0"]').getBoundingClientRect();
      const scale = box.width / 300;
      const points = [
        [150, 300], [150, 250], [150, 200], [150, 160], [250, 250],
        [250, 300], [250, 350], [50, 300], [50, 250], [150, 340],
        [200, 200], [200, 250], [100, 94], [90, 94],
      ];
      return points.map(([px, py]) => {
        const x = box.x + px * scale;
        const y = box.y + py * scale;
        const element = document.elementFromPoint(x, y);
        const path = window.document.elementFromPoint(x, y)
          ? Array.from(document.elementsFromPoint(x, y)).slice(0, 6)
          : [];
        return {
          point: [px, py],
          topTag: element?.tagName,
          topClass: String(element?.className ?? "").slice(0, 60),
          classes: path.map((node) => String(node.className ?? node.nodeName).slice(0, 40)),
        };
      });
    }),
    null,
    2,
  ),
);
await browser.close();
