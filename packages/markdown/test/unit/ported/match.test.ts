import test from "node:test";
import assert from "node:assert/strict";
import { fuzzyMatch, queryTokens } from "../../../src/shared/fuzzy";

// Every expected score and range below is what Obsidian 1.14.4's public
// prepareFuzzySearch returned for the same query and text (none has an accent,
// so 1.15.0's folding leaves them as they were).
const cases: [string, string, number | undefined, [number, number][]][] = [
  ["att", "Attention", -0.0109, [[0, 3]]],
  ["ten", "Attention", -0.1129, [[2, 5]]],
  [
    "atn",
    "Attention",
    -1.1309,
    [
      [0, 2],
      [4, 5],
    ],
  ],
  ["a", "abc", -0.0103, [[0, 1]]],
  [
    "ab",
    "a-b",
    -1.0203,
    [
      [0, 1],
      [2, 3],
    ],
  ],
  [
    "ML atten",
    "ml/Attention",
    -1.0112,
    [
      [0, 2],
      [3, 8],
    ],
  ],
  ["", "Anything", 0, []],
  ["aa aa", "aaaa", -0.1004, [[0, 4]]],
  ["---", "a---b", -0.0115, [[1, 4]]],
  [
    "ab cd",
    "a-b c-d",
    -3.0307,
    [
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
    ],
  ],
  // A capital after a small letter starts a word; after a capital it does not.
  [
    "pp",
    "ProjectPlan",
    -1.0711,
    [
      [0, 1],
      [7, 8],
    ],
  ],
  [
    "ak",
    "APIKey",
    -1.1306,
    [
      [0, 1],
      [3, 4],
    ],
  ],
  [
    "xhr",
    "XMLHttpRequest",
    -2.1614,
    [
      [0, 1],
      [3, 4],
      [7, 8],
    ],
  ],
  // A letter matched inside a word costs a tenth.
  [
    "ra",
    "Roadmap 2024",
    -1.1212,
    [
      [0, 1],
      [2, 3],
    ],
  ],
];

test("scores and ranges are Obsidian's", () => {
  for (const [query, text, score, matches] of cases) {
    const match = fuzzyMatch(query, text);
    assert.ok(match, `${query}: ${text}`);
    assert.equal(
      Math.round(match.score * 1e4) / 1e4,
      score,
      `${query}: ${text}`,
    );
    assert.deepEqual(match.matches, matches, `${query}: ${text}`);
  }
});

test("words and letters must be found in order, each after the last", () => {
  for (const [query, text] of [
    ["beta alpha", "alpha beta"],
    ["ab cd", "c-d a-b"],
    ["机器", "器械与机械"],
    ["a a", "a"],
    ["ML atten", "Attention"],
    ["attention zebra", "Attention"],
    ["---", "anything"],
  ]) {
    assert.equal(fuzzyMatch(query!, text!), undefined, `${query}: ${text}`);
  }
});

test("Han and kana are words alone in a query, as punctuation is", () => {
  assert.deepEqual(queryTokens("机器 Learning"), ["机", "器", "learning"]);
  assert.deepEqual(queryTokens("Learning机器"), ["learning", "机", "器"]);
  assert.deepEqual(queryTokens("a-b  c"), ["a", "-", "b", "c"]);
});

test("a ligature is its own text; a decomposed letter folds like a composed one", () => {
  assert.equal(fuzzyMatch("ffi", "\uFB03"), undefined);
  // The ring above belongs to the A it follows, so the range covers both.
  assert.deepEqual(fuzzyMatch("\u00E5", "A\u030A")?.matches, [[0, 2]]);
  assert.deepEqual(fuzzyMatch("\u00E5", "\u00E5")?.matches, [[0, 1]]);
});

// Obsidian 1.15.0 folds accents (read in its shipped code; behaviour only).
test("accents are ignored: cafe finds café, and café finds cafe", () => {
  assert.deepEqual(fuzzyMatch("cafe", "Caf\u00E9"), {
    score: fuzzyMatch("cafe", "Cafe")!.score,
    matches: [[0, 4]],
  });
  assert.deepEqual(fuzzyMatch("ecole", "\u00C9COLE")?.matches, [[0, 5]]);
  assert.deepEqual(fuzzyMatch("cafe", "Cafe\u0301 au lait")?.matches, [[0, 5]]);
  assert.deepEqual(
    fuzzyMatch("\u0435\u043B\u043A\u0430", "\u0401\u043B\u043A\u0430")?.matches,
    [[0, 4]],
  );
});

test("a query typed with an accent ranks the accented text higher", () => {
  const accented = fuzzyMatch("caf\u00E9", "caf\u00E9")!.score;
  const plain = fuzzyMatch("caf\u00E9", "cafe")!.score;
  assert.equal(Math.round((accented - plain) * 1e4) / 1e4, 0.05);
  assert.equal(accented, fuzzyMatch("cafe", "cafe")!.score);
});
