import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await page.goto("http://127.0.0.1:19239/?toolbar=slim&view=" + encodeURIComponent(JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" })));
await page.locator(".page img").first().waitFor({ state: "visible" });
await page.waitForTimeout(300);
console.log(JSON.stringify(await page.evaluate(() => {
  const box = document.querySelector('.page[data-page-index="0"]').getBoundingClientRect();
  const links = [...document.querySelectorAll(".page-link")].map((link) => {
    const rect = link.getBoundingClientRect();
    return { left: (rect.left - box.left) / (box.width / 300), top: (rect.top - box.top) / (box.width / 300), width: rect.width / (box.width / 300), height: rect.height / (box.width / 300), href: link.getAttribute("href") };
  });
  return { box: { x: box.x, y: box.y, width: box.width, height: box.height }, links };
}), null, 2));
await browser.close();
