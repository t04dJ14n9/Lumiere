import { chromium } from "@playwright/test";
const FIND_CAPS = () => {
  const root = document.getElementById("root");
  const key = Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
  const seen = new Set(); const stack = [root[key]];
  let interaction = null, selection = null;
  const inspect = (v) => {
    if (!v || typeof v !== "object") return;
    if (!interaction && typeof v.getActiveTool === "function" && typeof v.wouldClaimTouch === "function") interaction = v;
    if (!selection && typeof v.isLoaded === "function" && typeof v.isOverText === "function") selection = v;
  };
  while (stack.length && (!interaction || !selection)) {
    const f = stack.pop(); if (!f || seen.has(f)) continue; seen.add(f);
    let h = f.memoizedState, g = 0;
    while (h && g++ < 200) { inspect(h.memoizedState); inspect(h.memoizedState?.value); inspect(h.memoizedState?.current); h = h.next; }
    inspect(f.memoizedProps); inspect(f.memoizedProps?.value); inspect(f.memoizedProps?.value?.current);
    if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling);
  }
  window.__caps = { interaction, selection };
  return Boolean(interaction && selection);
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const view = encodeURIComponent(JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }));
await page.goto("http://127.0.0.1:19239/?toolbar=slim&view=" + view);
await page.locator(".page img").first().waitFor({ state: "visible" });
await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
await page.evaluate(FIND_CAPS);
const box = await page.locator(".page").first().boundingBox();
const scale = box.width / 300;
const blank = { x: box.x + 250 * scale, y: box.y + 250 * scale };
const text = { x: box.x + 90 * scale, y: box.y + 94 * scale };
for (let i = 0; i < 40; i++) {
  await page.mouse.move(text.x + (i % 2), text.y);
  if ((await page.evaluate(([x,y]) => getComputedStyle(document.elementFromPoint(x,y)).cursor, [text.x, text.y])) === "text") break;
  await page.waitForTimeout(50);
}
await page.evaluate(() => {
  const { selection, interaction } = window.__caps;
  window.__originalIsLoaded = selection.isLoaded;
  selection.isLoaded = () => false;
  window.__gestures = [];
  interaction.onGestureStarted((g) => window.__gestures.push(g));
  const orig = interaction.dispatchPointer.bind(interaction);
  interaction.dispatchPointer = (s) => { window.__gestures.push({ sample: s.phase }); return orig(s); };
});
const before = await page.evaluate(() => window.__messages.filter(m=>m.patch?.view).at(-1).patch.view.readingPage);
await page.mouse.move(blank.x, blank.y);
await page.mouse.down();
await page.mouse.move(blank.x, blank.y - 120, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(600);
console.log("STUBBED COLD", JSON.stringify(await page.evaluate(() => ({
  before: window.__before ?? null,
  readingPage: window.__messages.filter(m=>m.patch?.view).at(-1).patch.view.readingPage,
  indexes: [...document.querySelectorAll(".page")].map(n=>Number(n.dataset.pageIndex)),
  gestures: window.__gestures,
  isLoadedStubbed: window.__caps.selection.isLoaded.toString().includes("false"),
}))));
// restore and repeat
await page.evaluate(() => { window.__caps.selection.isLoaded = window.__originalIsLoaded; window.__gestures = []; });
await page.mouse.move(blank.x, blank.y);
await page.mouse.down();
await page.mouse.move(blank.x, blank.y - 120, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(600);
console.log("RESTORED WARM", JSON.stringify(await page.evaluate(() => ({
  readingPage: window.__messages.filter(m=>m.patch?.view).at(-1).patch.view.readingPage,
  indexes: [...document.querySelectorAll(".page")].map(n=>Number(n.dataset.pageIndex)),
  gestures: window.__gestures,
}))));
await browser.close();
