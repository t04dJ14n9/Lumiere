import assert from "node:assert/strict";
import { test } from "node:test";
import { findTextFragment } from "../../src/shared/pdf-backlink-resolve";

test("matching ignores case and runs of whitespace of every kind", () => {
  const page = "Scaled\t\tdot    PRODUCT\r\n\r\n  Attention";
  assert.deepEqual(findTextFragment(page, "scaled DOT product attention"), {
    start: 0,
    end: page.length,
  });
  assert.deepEqual(findTextFragment(page, "  dot product  "), {
    start: page.indexOf("dot"),
    end: page.indexOf("PRODUCT") + "PRODUCT".length,
  });
});

test("a soft hyphen or zero-width space in the page text is no obstacle", () => {
  const page = "infor­mation re​trieval";
  assert.deepEqual(findTextFragment(page, "information retrieval"), {
    start: 0,
    end: page.length,
  });
});

test("a missing quote or a blank textStart does not match", () => {
  assert.equal(findTextFragment("some text", "other text"), undefined);
  assert.equal(findTextFragment("some text", ""), undefined);
  assert.equal(findTextFragment("some text", " \r\n "), undefined);
  assert.equal(findTextFragment("some text", { textStart: "\n" }), undefined);
});

test("the range is traced back to raw offsets past case and surrogate quirks", () => {
  // "İ" lower-cases to two units and an emoji is two units: neither may shift
  // the offsets of what follows.
  const dotted = "İstanbul\r\nx";
  assert.deepEqual(findTextFragment(dotted, "stanbul x"), {
    start: 1,
    end: dotted.length,
  });
  const emoji = "a \u{1f600}\r\nb";
  assert.deepEqual(findTextFragment(emoji, "a \u{1f600}"), {
    start: 0,
    end: 4,
  });
  assert.deepEqual(findTextFragment(emoji, "\u{1f600} b"), {
    start: 2,
    end: emoji.length,
  });
});

test("textEnd must come after textStart", () => {
  const page = "end of it, then start of it";
  assert.equal(
    findTextFragment(page, { textStart: "start", textEnd: "end" }),
    undefined,
  );
  assert.deepEqual(
    findTextFragment(page, { textStart: "end", textEnd: "it" }),
    { start: 0, end: "end of it".length },
  );
});

test("prefix and suffix choose among repeats and are not part of the match", () => {
  const page = "alpha beta. gamma beta delta. gamma beta omega";
  const second = page.indexOf("beta", page.indexOf("gamma"));
  const third = page.lastIndexOf("beta");
  const gamma = page.indexOf("gamma");
  assert.deepEqual(
    findTextFragment(page, { textStart: "beta", prefix: "gamma" }),
    { start: second, end: second + 4 },
  );
  assert.deepEqual(
    findTextFragment(page, {
      textStart: "beta",
      prefix: "gamma",
      suffix: "omega",
    }),
    { start: third, end: third + 4 },
  );
  assert.deepEqual(
    findTextFragment(page, { textStart: "gamma", suffix: "beta delta" }),
    { start: gamma, end: gamma + 5 },
  );
  assert.equal(
    findTextFragment(page, { textStart: "beta", prefix: "omega" }),
    undefined,
  );
  assert.equal(
    findTextFragment(page, { textStart: "beta", suffix: "gamma delta" }),
    undefined,
  );
});

test("prefix and suffix may sit across a line break, but must be adjacent", () => {
  const page = "left side\r\ntarget words\r\nright side";
  assert.ok(
    findTextFragment(page, {
      textStart: "target words",
      prefix: "left side",
      suffix: "right side",
    }),
  );
  assert.equal(
    findTextFragment(page, { textStart: "target", prefix: "left" }),
    undefined,
  );
});

test("textEnd with a suffix takes the first end the suffix allows", () => {
  const page = "from a to b. from a to c";
  assert.deepEqual(
    findTextFragment(page, { textStart: "from", textEnd: "to", suffix: "c" }),
    { start: 0, end: page.lastIndexOf("to") + 2 },
  );
  assert.deepEqual(
    findTextFragment(page, { textStart: "from", textEnd: "to c" }),
    { start: 0, end: page.length },
  );
});
