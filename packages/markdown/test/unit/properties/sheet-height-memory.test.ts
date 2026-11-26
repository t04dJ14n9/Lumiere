import assert from "node:assert/strict";
import test from "node:test";
import {
  forgetSheetHeights,
  rememberedSheetHeight,
  rememberSheetHeight,
} from "../../../src/markdown/properties/sheet-height-memory";
import { PropertyWidget } from "../../../src/plugins/properties/widget";
import type { PropertyContext } from "../../../src/plugins/properties/context";

const SOURCE = "---\ntitle: A\nstatus: open\n---\n";

/** A sheet with these settings; only what `sheetMarkup` reads. */
const context = (collapsed = false) =>
  ({
    propertyEditor: { collapsed: () => collapsed },
  }) as unknown as PropertyContext;

test("the sheet starts from the height its skeleton measured, not from an estimate", () => {
  const guess = new PropertyWidget(SOURCE, context(), false).estimatedHeight;
  assert.ok(guess > 0);
  rememberSheetHeight(SOURCE, guess + 2.5);
  assert.equal(
    new PropertyWidget(SOURCE, context(), false).estimatedHeight,
    guess + 2.5,
  );
});

test("a collapsed sheet, or one for other frontmatter, keeps its own estimate", () => {
  rememberSheetHeight(SOURCE, 500);
  const collapsed = new PropertyWidget(SOURCE, context(true), false)
    .estimatedHeight;
  assert.ok(collapsed < 100, `a collapsed sheet is ${collapsed}, not 500`);
  const other = "---\ntitle: B\n---\n";
  assert.equal(rememberedSheetHeight(other), undefined);
  assert.ok(new PropertyWidget(other, context(), false).estimatedHeight < 500);
});

test("only the latest few heights are kept, and a height of nothing is not one", () => {
  rememberSheetHeight("---\nzero: 1\n---\n", 0);
  assert.equal(rememberedSheetHeight("---\nzero: 1\n---\n"), undefined);
  for (let i = 0; i < 20; i++) {
    rememberSheetHeight(`---\nk${i}: 1\n---\n`, 100 + i);
  }
  assert.equal(rememberedSheetHeight("---\nk0: 1\n---\n"), undefined);
  assert.equal(rememberedSheetHeight("---\nk19: 1\n---\n"), 119);
});

test("the opening's heights are forgotten when it is over", () => {
  rememberSheetHeight(SOURCE, 321);
  assert.equal(rememberedSheetHeight(SOURCE), 321);
  forgetSheetHeights();
  assert.equal(rememberedSheetHeight(SOURCE), undefined);
});
