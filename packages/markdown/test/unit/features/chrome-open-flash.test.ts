import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture";

/** Active plugin ids after a configure settles. */
function running(f: ReturnType<typeof fixture>): Set<string> {
  return new Set(
    [...f.root.plugins].map((fiber) => fiber.definition.name as string),
  );
}

/**
 * No-flash open contract: Properties sheet + line-number gutter are editor
 * chrome geometry. Mounting them in `phase: "chrome"` (not waiting on the
 * later paint set of tables/callouts/…) keeps the first meaningful chrome
 * frame from popping gutter/sheet in after glyphs.
 */
test("chrome phase mounts Properties and lineNumbers together before paint structure", async () => {
  const f = fixture();
  await f.configure(
    {
      properties: { enabled: true, config: {} },
      lineNumbers: { enabled: true, config: { style: "on" } },
      tables: { enabled: true, config: {} },
      tags: { enabled: true, config: {} },
    },
    false,
    "chrome",
  );
  const chrome = running(f);
  assert.equal(chrome.has("properties"), true);
  assert.equal(
    chrome.has("lineNumbers"),
    true,
    "lineNumbers must ride with Properties chrome so the gutter is not injected on paint",
  );
  assert.equal(chrome.has("tables"), false);
  assert.equal(chrome.has("tags"), false);
  await f.root.dispose();
});

test("paint phase still owns tables while keeping chrome features mounted", async () => {
  const f = fixture();
  await f.configure(
    {
      properties: { enabled: true, config: {} },
      lineNumbers: { enabled: true, config: { style: "on" } },
      tables: { enabled: true, config: {} },
    },
    false,
    "chrome",
  );
  await f.configure(
    {
      properties: { enabled: true, config: {} },
      lineNumbers: { enabled: true, config: { style: "on" } },
      tables: { enabled: true, config: {} },
    },
    false,
    "paint",
  );
  const painted = running(f);
  assert.equal(painted.has("properties"), true);
  assert.equal(painted.has("lineNumbers"), true);
  assert.equal(painted.has("tables"), true);
  await f.root.dispose();
});
