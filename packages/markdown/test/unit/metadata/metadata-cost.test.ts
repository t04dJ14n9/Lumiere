import test from "node:test";
import assert from "node:assert/strict";
import { metadata } from "../../../src/markdown/metadata";
import { definitionLookup } from "../../../src/markdown/metadata/collect";

/** The fastest of three extractions of `text`, in ms. */
function fastest(text: string): number {
  let best = Infinity;
  for (let run = 0; run < 3; run++) {
    // A fresh string each run: metadata() caches by the note's Text.
    const copy = `${text}\n`;
    const start = performance.now();
    metadata(copy);
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

function footnotes(count: number): string {
  return Array.from(
    { length: count },
    (_, i) => `Ref[^${i}].\n\n[^${i}]: Note ${i} [[Target ${i}]]\n\n`,
  ).join("");
}

test("each footnote definition costs the same however many the note has", () => {
  const note = metadata(footnotes(3));
  assert.deepEqual(
    note.links.map((link) => link.link),
    ["Target 0", "Target 1", "Target 2"],
  );
  // Sixteen times the footnotes: about sixteen times the time when each
  // node is checked against one definition, far more against all of them
  // (measured: 13x when checked against one, 79x against all).
  const small = fastest(footnotes(1000));
  const large = fastest(footnotes(16000));
  assert.ok(
    large / small < 30,
    `1,000 footnotes: ${small.toFixed(1)} ms; 16,000: ${large.toFixed(1)} ms`,
  );
});

test("a definition lookup answers in document order, each definition passed once", () => {
  const definitions = [
    { from: 50, to: 60 },
    { from: 10, to: 20 },
    { from: 30, to: 40 },
  ];
  const inDefinition = definitionLookup(definitions);
  const answers = [
    [0, 5],
    [10, 20],
    [12, 14],
    [20, 25],
    [30, 31],
    [35, 45],
    [55, 60],
    [61, 70],
  ].map(([from, to]) => inDefinition(from!, to!));
  assert.deepEqual(answers, [
    false,
    true,
    true,
    false,
    true,
    false,
    true,
    false,
  ]);
});
