import assert from "node:assert/strict";
import { test } from "node:test";
import { agentText, pageLinkText } from "../../src/shared/agent-text";

const source = { path: "papers/attention_v2.pdf" };

test("text selection Quote puts blockquote before the deep link", () => {
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
    [
      "> Scaled dot-product attention",
      ">",
      "> [attention_v2.pdf · p.3](papers/attention_v2.pdf#page=3#:~:text=Scaled%20dot%2Dproduct%20attention)",
    ].join("\n"),
  );
  assert.doesNotMatch(text, /viewrect=|selection=|search=/u);
});

test("pageLinkText is page only", () => {
  assert.equal(
    pageLinkText(source, 3),
    "[attention_v2.pdf · p.3](papers/attention_v2.pdf#page=3)",
  );
});

test("region without regionsEnabled omits viewrect and uses text fragment when text present", () => {
  const text = agentText(
    {
      kind: "region",
      page: 3,
      rect: [72, 410, 292, 436],
      text: "scaled",
    },
    source,
    { regionsEnabled: false },
  );
  assert.doesNotMatch(text, /viewrect=/u);
  assert.match(text, /#:~:text=/u);
});

test("a selection across pages lists one quoted link per page after the quote", () => {
  const text = agentText(
    {
      kind: "text",
      text: "end of one page and start of the next",
      pages: [
        { page: 4, rects: [[72, 350, 200, 362]] },
        { page: 5, rects: [[72, 40, 180, 52]] },
      ],
    },
    source,
  );
  assert.equal(
    text,
    [
      "> end of one page and start of the next",
      ">",
      "> [attention_v2.pdf · p.4](papers/attention_v2.pdf#page=4#:~:text=end%20of%20one%20page%20and%20start%20of%20the%20next)",
      "> [attention_v2.pdf · p.5](papers/attention_v2.pdf#page=5#:~:text=end%20of%20one%20page%20and%20start%20of%20the%20next)",
    ].join("\n"),
  );
});

test("a region without text is link-only; viewrect only when regions enabled", () => {
  assert.equal(
    agentText({ kind: "region", page: 7, rect: [150, 200, 250, 300] }, source),
    "[attention_v2.pdf · p.7](papers/attention_v2.pdf#page=7)",
  );
  assert.equal(
    agentText({ kind: "region", page: 7, rect: [150, 200, 250, 300] }, source, {
      regionsEnabled: true,
    }),
    "[attention_v2.pdf · p.7](papers/attention_v2.pdf#page=7&viewrect=150,200,100,100)",
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
      "> N d_model",
      "> base 6 512",
      ">",
      "> [attention_v2.pdf · p.9](papers/attention_v2.pdf#page=9&viewrect=92,126,428,261)",
    ].join("\n"),
  );
  assert.doesNotMatch(text, /Region image|SHA-256|Source:|#:~:text=/u);
});

test("file names and folders containing # or ? keep the full basename in the label", () => {
  assert.equal(
    pageLinkText({ path: "papers/issue#1.pdf" }, 3),
    "[issue#1.pdf · p.3](papers/issue%231.pdf#page=3)",
  );
  assert.equal(
    pageLinkText({ path: "C#/what?.pdf" }, 3),
    "[what?.pdf · p.3](C%23/what?.pdf#page=3)",
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
    [
      "> Scaled dot-product attention",
      ">",
      "> [issue#1.pdf · p.3](C%23/issue%231.pdf#page=3#:~:text=Scaled%20dot%2Dproduct%20attention)",
    ].join("\n"),
  );
});

test("a file name with brackets is escaped in the label", () => {
  assert.equal(
    pageLinkText({ path: "papers/a]b.pdf" }, 3),
    "[a\\]b.pdf · p.3](papers/a]b.pdf#page=3)",
  );
  assert.equal(
    pageLinkText({ path: "papers/[Smith] Title [2020].pdf" }, 3),
    "[\\[Smith\\] Title \\[2020\\].pdf · p.3](papers/[Smith]%20Title%20[2020].pdf#page=3)",
  );
});

test("a file name with a line break keeps the whole quote block quoted", () => {
  const text = agentText(
    {
      kind: "text",
      text: "Scaled dot-product attention",
      pages: [{ page: 3, rects: [[72, 83, 150, 95]] }],
    },
    { path: "papers/a\nb.pdf" },
  );
  assert.equal(
    text,
    [
      "> Scaled dot-product attention",
      ">",
      "> [a b.pdf · p.3](papers/a%0Ab.pdf#page=3#:~:text=Scaled%20dot%2Dproduct%20attention)",
    ].join("\n"),
  );
  assert.equal(
    pageLinkText({ path: "papers/a\r\nb.pdf" }, 3),
    "[a b.pdf · p.3](papers/a%0D%0Ab.pdf#page=3)",
  );
});
