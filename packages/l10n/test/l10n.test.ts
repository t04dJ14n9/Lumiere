import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  configureL10n,
  l10nLanguage,
  l10nMeta,
  readL10n,
  t,
} from "../src/l10n";

afterEach(() => configureL10n(undefined));

test("with no bundle the English text is shown, placeholders filled", () => {
  assert.equal(t("Open"), "Open");
  assert.equal(t("Page {0} of {1}", 3, 10), "Page 3 of 10");
});

test("a bundle translates the text, in either of VS Code's entry forms", () => {
  configureL10n(
    {
      Open: "打开",
      "Page {0} of {1}": { message: "第 {0} 页，共 {1} 页", comment: ["x"] },
    },
    "zh-cn",
  );
  assert.equal(t("Open"), "打开");
  assert.equal(t("Page {0} of {1}", 3, 10), "第 3 页，共 10 页");
  assert.equal(t("Not translated"), "Not translated");
  assert.equal(l10nLanguage(), "zh-cn");
});

test("a placeholder without its argument stays as written", () => {
  assert.equal(t("{0} and {1}", "a"), "a and {1}");
});

/** A page with `html` in its head, as much of a document as readL10n reads. */
function page(html: string) {
  const content = /content="([^"]*)"/u.exec(html)?.[1];
  const value = content
    ?.replace(/&quot;/gu, '"')
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
  return {
    querySelector: () =>
      value === undefined ? null : { getAttribute: () => value },
  };
}

test("a page carries the bundle in an escaped meta element, and a webview reads it back", () => {
  configureL10n({ 'a"</meta>': "b&</script>" }, "zh-cn");
  const html = l10nMeta();
  assert.match(html, /^<meta name="lumiere-l10n" content="[^"<>]*">$/u);
  configureL10n(undefined);
  readL10n(page(html));
  assert.equal(t('a"</meta>'), "b&</script>");
  assert.equal(l10nLanguage(), "zh-cn");
});

test("a page without a valid bundle stays in English", () => {
  readL10n(page('<meta content="{not json">'));
  assert.equal(t("Open"), "Open");
  readL10n(page("<meta>"));
  assert.equal(t("Open"), "Open");
});
