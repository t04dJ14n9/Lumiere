import assert from "node:assert/strict";
import test from "node:test";
import {
  clearNoteEmbedHeights,
  embedEstimatedHeight,
  rememberNoteEmbedHeight,
} from "./estimated-height";
import { writtenHeight, writtenWidth } from "./image-size";

test("WxH size reserves the written height, not one line", () => {
  assert.equal(writtenWidth("![[pic.png|200x800]]"), 200);
  assert.equal(writtenHeight("![[pic.png|200x800]]"), 800);
  assert.equal(writtenHeight("![alt|200x800](a.png)"), 800);
  assert.equal(writtenHeight("![200](a.png)"), undefined);
  const height = embedEstimatedHeight("![[pic.png|200x800]]");
  // Default WidgetType estimatedHeight (-1) → ~24px. Explicit 800px tall.
  assert.ok(height > 700, `got ${height}`);
  assert.ok(height < 900, `got ${height}`);
});

test("width-only and unsized images still beat the one-line default", () => {
  const sized = embedEstimatedHeight("![[pic.png|100]]");
  const plain = embedEstimatedHeight("![[pic.png]]");
  const markdown = embedEstimatedHeight("![alt](https://ex.com/a.png)");
  const data = embedEstimatedHeight(
    "![tall](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=)",
  );
  for (const height of [sized, plain, markdown, data]) {
    assert.ok(height > 200, `got ${height}`);
  }
});

test("note embeds reserve a multi-paragraph floor above the old 120px", () => {
  clearNoteEmbedHeights();
  const note = embedEstimatedHeight("![[Note]]");
  const heading = embedEstimatedHeight("![[Other#Heading]]");
  const md = embedEstimatedHeight("![[folder/Other.md]]");
  // Previously NOTE_DEFAULT was 120 (+ chrome ≈136). Tall notes need more.
  for (const height of [note, heading, md]) {
    assert.ok(height > 300, `got ${height}`);
  }
  assert.ok(embedEstimatedHeight("![[clip.mp4]]") > 150);
  assert.ok(embedEstimatedHeight("![[doc.pdf]]") > 40);
  assert.ok(embedEstimatedHeight("![[doc.pdf]]") < 120);
});

test("remembered note-embed height beats the floor on remount estimate", () => {
  clearNoteEmbedHeights();
  const source = "![[TallNote]]";
  const floor = embedEstimatedHeight(source);
  rememberNoteEmbedHeight(source, 900);
  const cached = embedEstimatedHeight(source);
  assert.ok(cached >= 900, `got ${cached}`);
  assert.ok(cached > floor, `${cached} vs floor ${floor}`);
  // Non-notes ignore the cache API.
  rememberNoteEmbedHeight("![[pic.png]]", 900);
  assert.ok(embedEstimatedHeight("![[pic.png]]") < 300);
  clearNoteEmbedHeights();
  assert.equal(embedEstimatedHeight(source), floor);
});

test("inline WxH images use the same height reserve as block embeds", () => {
  // Mid-paragraph `text ![[pic|200x800]] more` still needs |WxH|, not one line.
  const height = embedEstimatedHeight("![[pic.png|200x800]]");
  assert.ok(height > 700, `got ${height}`);
});

test("a link a plugin claims reserves the height it names, not a PDF card", () => {
  // Online Videos claims a tweet's link while it runs in a trusted workspace
  // (`render/claimedHeight`) and says how tall its frame starts.
  const pdf = embedEstimatedHeight("![[doc.pdf]]");
  const claim = (target: string) =>
    /^https:\/\/(x|twitter)\.com\/jack\/status\/\d+/.test(target)
      ? 400
      : undefined;
  for (const link of [
    "https://x.com/jack/status/1590000000000000000",
    "https://twitter.com/jack/status/20?s=20",
  ]) {
    const height = embedEstimatedHeight(`![](${link})`, claim);
    assert.equal(height, 400 + 16, link);
    assert.ok(height > pdf * 2, `embed=${height} pdf=${pdf}`);
  }
  assert.equal(
    embedEstimatedHeight("![](https://example.com/page)", claim),
    pdf,
  );
});

test("a tweet link nobody claims (the plugin off, or an untrusted workspace) keeps the card reserve", () => {
  const card = embedEstimatedHeight("![[doc.pdf]]");
  const link = "![](https://x.com/jack/status/20)";
  assert.equal(embedEstimatedHeight(link), card);
  assert.equal(
    embedEstimatedHeight(link, () => undefined),
    card,
  );
});

test("links that are not embedded keep the card reserve, whatever site they name", () => {
  const card = embedEstimatedHeight("![[doc.pdf]]");
  for (const link of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.bilibili.com/video/BV1DRHU6LELy",
    "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl",
    "https://vimeo.com/22439234",
    "https://twitter.com/jack",
  ]) {
    assert.equal(embedEstimatedHeight(`![](${link})`), card, link);
  }
});
