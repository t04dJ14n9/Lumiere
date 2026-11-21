import test from "node:test";
import assert from "node:assert/strict";
import { parseVideoUrl } from "./parse";

const ID = "dQw4w9WgXcQ";

test("YouTube watch, youtu.be, Shorts, embed and live links give the video ID", () => {
  for (const link of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&list=PL123&index=2`,
    `https://m.youtube.com/watch?feature=share&v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `http://www.youtube-nocookie.com/embed/${ID}/`,
  ]) {
    assert.deepEqual(
      parseVideoUrl(link),
      {
        provider: "youtube",
        kind: "video",
        id: ID,
        page: `https://www.youtube.com/watch?v=${ID}`,
      },
      link,
    );
  }
});

test("YouTube start times in seconds or h/m/s", () => {
  assert.equal(parseVideoUrl(`https://youtu.be/${ID}?t=90`)?.start, 90);
  assert.equal(
    parseVideoUrl(`https://www.youtube.com/watch?v=${ID}&t=1m30s`)?.start,
    90,
  );
  assert.equal(
    parseVideoUrl(`https://www.youtube.com/embed/${ID}?start=3723`)?.page,
    `https://www.youtube.com/watch?v=${ID}&t=3723s`,
  );
  assert.equal(
    parseVideoUrl(`https://youtu.be/${ID}?t=soon`)?.start,
    undefined,
  );
  assert.equal(parseVideoUrl(`https://youtu.be/${ID}?t=0`)?.start, undefined);
});

test("the removed providers, and YouTube playlists and channels, are not recognised", () => {
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
    "https://www.youtube.com/playlist?list=PL4cUxeGkcC9gZD-Tvwfod2gaISzfRiP9d",
    "https://www.youtube.com/embed/videoseries?list=PL4cUxeGkcC9gZD-Tvwfod2gaISzfRiP9d",
    "https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw",
    "https://www.youtube.com/@GoogleDevelopers",
    "https://www.youtube.com/c/GoogleDevelopers",
    "https://www.youtube.com/user/GoogleDevelopers",
  ]) {
    assert.equal(parseVideoUrl(link), undefined, link);
  }
});

test("a malformed ID, a lookalike host or a hostile URL is refused", () => {
  for (const link of [
    "https://www.youtube.com/watch?v=short",
    `https://www.youtube.com/watch?v=${ID}x`,
    "https://www.youtube.com/watch",
    `https://www.youtube.com.evil.test/watch?v=${ID}`,
    `https://evil.test/youtube.com/watch?v=${ID}`,
    `https://user:pw@www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com:8443/watch?v=${ID}`,
    `javascript:alert(1)//youtube.com/watch?v=${ID}`,
    `ftp://youtu.be/${ID}`,
    "not a url",
    "",
  ]) {
    assert.equal(parseVideoUrl(link), undefined, link);
  }
});
