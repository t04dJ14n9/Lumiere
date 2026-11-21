import test from "node:test";
import assert from "node:assert/strict";
import { parseTweet } from "./parse";

const TWEET = "1590000000000000000";
const tweet = {
  id: TWEET,
  page: `https://x.com/i/status/${TWEET}`,
};

test("tweet links from twitter.com, x.com and mobile give the tweet ID", () => {
  for (const link of [
    `https://twitter.com/jack/status/${TWEET}`,
    `https://x.com/jack/status/${TWEET}`,
    `http://twitter.com/jack/status/${TWEET}`,
    `https://mobile.twitter.com/jack/status/${TWEET}`,
    `https://mobile.x.com/jack/status/${TWEET}`,
    `https://twitter.com/jack/status/${TWEET}?s=20&t=abc`,
    `https://x.com/jack/status/${TWEET}/`,
    `https://x.com/jack/status/${TWEET}#reply`,
    `https://x.com/jack/status/${TWEET}/photo/1`,
    `https://twitter.com/jack/status/${TWEET}/video/2`,
    `https://x.com/i/status/${TWEET}`,
    `https://twitter.com/i/web/status/${TWEET}`,
    `https://twitter.com/user_name_15/status/${TWEET}`,
  ]) {
    assert.deepEqual(parseTweet(link), tweet, link);
  }
  assert.deepEqual(parseTweet("https://twitter.com/jack/status/20"), {
    id: "20",
    page: "https://x.com/i/status/20",
  });
});

test("other X and Twitter pages, and bad tweet IDs, are not embedded", () => {
  for (const link of [
    "https://twitter.com/jack",
    "https://twitter.com/jack/likes",
    "https://twitter.com/search?q=lumiere",
    "https://twitter.com/jack/lists/12",
    `https://twitter.com/jack/status/${TWEET}/likes`,
    `https://twitter.com/jack/status/${TWEET}/photo/x`,
    `https://twitter.com/jack/statuses/${TWEET}`,
    "https://twitter.com/jack/status/",
    "https://twitter.com/jack/status/abc",
    "https://twitter.com/jack/status/0123",
    "https://twitter.com/jack/status/0",
    `https://twitter.com/jack/status/${TWEET}1`,
    "https://twitter.com/jack/status/12e3",
    "https://twitter.com/a-b/status/1",
    "https://twitter.com/sixteen_chars_xxx/status/1",
    `https://twitter.com/jack/status/${TWEET}/../../evil`,
    `https://www.twitter.com/jack/status/${TWEET}`,
    `https://www.x.com/jack/status/${TWEET}`,
    `https://api.twitter.com/jack/status/${TWEET}`,
    `https://platform.twitter.com/jack/status/${TWEET}`,
    `https://twitter.com.evil.test/jack/status/${TWEET}`,
    `https://eviltwitter.com/jack/status/${TWEET}`,
    `https://x.com.evil.test/jack/status/${TWEET}`,
    `https://nex.com/jack/status/${TWEET}`,
    `https://user@twitter.com/jack/status/${TWEET}`,
    `https://twitter.com:444/jack/status/${TWEET}`,
    `javascript:alert(1)//twitter.com/jack/status/${TWEET}`,
    `twitter.com/jack/status/${TWEET}`,
  ]) {
    assert.equal(parseTweet(link), undefined, link);
  }
});

test("YouTube links are not embedded: its player shows Error 153 in VS Code", () => {
  for (const link of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?t=42",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ]) {
    assert.equal(parseTweet(link), undefined, link);
  }
});

test("the providers Online Videos used to card are no longer parsed", () => {
  for (const link of [
    "https://www.bilibili.com/video/BV1DRHU6LELy",
    "https://www.bilibili.com/video/av170001?p=2",
    "https://www.bilibili.com/bangumi/play/ep409506",
    "https://space.bilibili.com/2",
    "https://live.bilibili.com/3",
    "https://huggingface.co/google/gemma-2-2b",
    "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl",
    "https://soundcloud.com/forss/flickermood",
    "https://www.npmjs.com/package/lodash",
    "https://vimeo.com/22439234",
    "https://player.vimeo.com/video/22439234",
  ]) {
    assert.equal(parseTweet(link), undefined, link);
  }
});
