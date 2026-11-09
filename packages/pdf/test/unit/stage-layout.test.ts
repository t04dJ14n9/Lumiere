import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewChoices } from "../../src/shared/view-settings";
import { layoutApplied, layoutSettings } from "../../src/webview/stage-layout";

const choices = (patch: Partial<ViewChoices> = {}): ViewChoices => ({
  pageLayout: "single",
  scrollMode: "continuous",
  scrollDirection: "vertical",
  ...patch,
});

test("each view choice is one Stage setting: flow, layout and spread, and where pages rest", () => {
  assert.deepEqual(layoutSettings(choices()), {
    flow: "continuous",
    layout: "vertical",
    spread: "none",
    fitAlign: { x: "center", y: "start" },
  });
  assert.deepEqual(
    layoutSettings(
      choices({
        pageLayout: "spreadCover",
        scrollMode: "paged",
        scrollDirection: "horizontal",
      }),
    ),
    {
      flow: "paged",
      layout: "horizontal",
      spread: "even",
      fitAlign: { x: "start", y: "center" },
    },
  );
  assert.equal(layoutSettings(choices({ pageLayout: "spread" })).spread, "odd");
});

test("the Stage has the layout when all three settings match the choices", () => {
  const wanted = choices({ scrollMode: "paged", pageLayout: "spread" });
  const settings = layoutSettings(wanted);
  assert.equal(layoutApplied(settings, wanted), true);
  assert.equal(
    layoutApplied({ ...settings, flow: "continuous" }, wanted),
    false,
  );
  assert.equal(
    layoutApplied({ ...settings, layout: "horizontal" }, wanted),
    false,
  );
  assert.equal(layoutApplied({ ...settings, spread: "even" }, wanted), false);
});
