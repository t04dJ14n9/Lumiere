import test from "node:test";
import assert from "node:assert/strict";
import { parseVideoUrl } from "./parse";
import {
  PLAYER_SANDBOX,
  isPlayerUrl,
  playerAttributes,
  playerUrl,
  thumbnailUrl,
} from "./player";

const video = (link: string) => {
  const parsed = parseVideoUrl(link);
  assert.ok(parsed, link);
  return parsed;
};

test("players come from the YouTube embed origin with the parsed ID", () => {
  assert.equal(
    playerUrl(video("https://youtu.be/dQw4w9WgXcQ?t=42")),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=42",
  );
});

test("player frames are sandboxed, lazy and send only the origin as referrer", () => {
  const attributes = playerAttributes(
    video("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
  );
  assert.equal(attributes.sandbox, PLAYER_SANDBOX);
  assert.doesNotMatch(PLAYER_SANDBOX, /allow-(top-navigation|popups|forms)/);
  assert.equal(attributes.loading, "lazy");
  assert.equal(attributes.referrerpolicy, "strict-origin-when-cross-origin");
  assert.equal(attributes.title, "YouTube video dQw4w9WgXcQ");
  assert.ok(isPlayerUrl(attributes.src!));
});

test("the allowlist accepts only the YouTube player shape", () => {
  assert.equal(
    isPlayerUrl("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"),
    true,
  );
  for (const href of [
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "http://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ/../../evil",
    "https://www.youtube-nocookie.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com.evil.test/embed/dQw4w9WgXcQ",
    "https://user@www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "not a url",
  ]) {
    assert.equal(isPlayerUrl(href), false, href);
  }
});

test("the still is derived from the ID alone", () => {
  assert.equal(
    thumbnailUrl(video("https://youtu.be/dQw4w9WgXcQ")),
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
});
