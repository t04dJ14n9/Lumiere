import assert from "node:assert/strict";
import { test } from "node:test";
import { agentText, pageReferenceText } from "../../src/shared/agent-text";

const source = { path: "papers/attention_v2.pdf" };

test("a text selection is the page locator, a blank line, the quote and a newline", () => {
  const text = agentText(
    {
      kind: "text",
      text: "Scaled dot-product attention",
      pages: [{ page: 3, rects: [[72, 83, 150, 95]] }],
    },
    source,
  );
  assert.equal(
    text,
    "@papers/attention_v2.pdf#page=3\n\n> Scaled dot-product attention\n",
  );
  assert.doesNotMatch(text, /viewrect=|selection=|search=|:~:text=|\]\(/u);
});

test("pageReferenceText is the page locator alone", () => {
  assert.equal(
    pageReferenceText(source, 3),
    "@papers/attention_v2.pdf#page=3\n",
  );
});

test("region without regionsEnabled omits viewrect and quotes its text", () => {
  assert.equal(
    agentText(
      { kind: "region", page: 3, rect: [72, 410, 292, 436], text: "scaled" },
      source,
      { regionsEnabled: false },
    ),
    "@papers/attention_v2.pdf#page=3\n\n> scaled\n",
  );
});

test("a selection across pages has one locator per page before the quote", () => {
  assert.equal(
    agentText(
      {
        kind: "text",
        text: "end of one page and start of the next",
        pages: [
          { page: 4, rects: [[72, 350, 200, 362]] },
          { page: 5, rects: [[72, 40, 180, 52]] },
        ],
      },
      source,
    ),
    [
      "@papers/attention_v2.pdf#page=4",
      "@papers/attention_v2.pdf#page=5",
      "",
      "> end of one page and start of the next",
      "",
    ].join("\n"),
  );
});

test("a region without text is the locator alone; viewrect only when regions enabled", () => {
  assert.equal(
    agentText({ kind: "region", page: 7, rect: [150, 200, 250, 300] }, source),
    "@papers/attention_v2.pdf#page=7\n",
  );
  assert.equal(
    agentText({ kind: "region", page: 7, rect: [150, 200, 250, 300] }, source, {
      regionsEnabled: true,
    }),
    "@papers/attention_v2.pdf#page=7&viewrect=150,200,100,100\n",
  );
});

test("a region with text quotes it when regions enabled; no image path", () => {
  const text = agentText(
    {
      kind: "region",
      page: 9,
      rect: [92, 126, 520, 387],
      text: "N d_model\nbase 6 512",
    },
    source,
    { regionsEnabled: true },
  );
  assert.equal(
    text,
    [
      "@papers/attention_v2.pdf#page=9&viewrect=92,126,428,261",
      "",
      "> N d_model",
      "> base 6 512",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(text, /Region image|SHA-256|Source:|#:~:text=/u);
});

test("a path with spaces, # or parentheses stays one locator token", () => {
  assert.equal(
    pageReferenceText({ path: "papers/issue#1.pdf" }, 3),
    "@papers/issue%231.pdf#page=3\n",
  );
  assert.equal(
    pageReferenceText({ path: "papers/my paper (v2).pdf" }, 3),
    "@papers/my%20paper%20%28v2%29.pdf#page=3\n",
  );
  assert.equal(
    agentText(
      {
        kind: "text",
        text: "Scaled dot-product attention",
        pages: [{ page: 3, rects: [[72, 83, 150, 95]] }],
      },
      { path: "C#/issue#1.pdf" },
    ),
    "@C%23/issue%231.pdf#page=3\n\n> Scaled dot-product attention\n",
  );
});

test("a path with a line break stays on the locator's line", () => {
  assert.equal(
    pageReferenceText({ path: "papers/a\r\nb.pdf" }, 3),
    "@papers/a%0D%0Ab.pdf#page=3\n",
  );
});
