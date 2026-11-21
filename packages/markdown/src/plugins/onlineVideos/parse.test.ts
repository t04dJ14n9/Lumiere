import test from "node:test";
import assert from "node:assert/strict";
import { parseWebEmbed } from "./parse";

const ID = "dQw4w9WgXcQ";
const video = {
  kind: "youtube",
  id: ID,
  page: `https://www.youtube.com/watch?v=${ID}`,
};

test("YouTube watch, youtu.be, embed and v links give the video ID", () => {
  for (const link of [
    `https://www.youtube.com/watch?v=${ID}`,
    `http://youtube.com/watch?v=${ID}&list=PL123&index=2`,
    `https://m.youtube.com/watch?feature=share&v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}/`,
    `https://www.youtu.be/${ID}?si=abc`,
    `https://m.youtu.be/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://youtube.com/embed/${ID}/`,
    `https://www.youtube.com/v/${ID}`,
    `  https://www.youtube.com/watch?v=${ID}  `,
  ]) {
    assert.deepEqual(parseWebEmbed(link), video, link);
  }
});

test("YouTube start times in seconds or h/m/s, from t= or start=", () => {
  const start = (link: string) => {
    const parsed = parseWebEmbed(link);
    return parsed?.kind === "youtube" ? parsed.start : undefined;
  };
  assert.equal(start(`https://youtu.be/${ID}?t=90`), 90);
  assert.equal(start(`https://youtu.be/${ID}?t=90s`), 90);
  assert.equal(start(`https://www.youtube.com/watch?v=${ID}&t=1m30s`), 90);
  assert.equal(start(`https://www.youtube.com/watch?v=${ID}&start=7`), 7);
  assert.equal(start(`https://www.youtube.com/embed/${ID}?start=3723`), 3723);
  assert.equal(start(`https://www.youtube.com/watch?t=5&v=${ID}`), 5);
  assert.equal(
    parseWebEmbed(`https://www.youtube.com/embed/${ID}?start=3723`)?.page,
    `https://www.youtube.com/watch?v=${ID}&t=3723s`,
  );
  for (const bad of ["soon", "0", "-5", "1e3", "5x", "1000000000", ""]) {
    assert.equal(start(`https://youtu.be/${ID}?t=${bad}`), undefined, bad);
  }
  assert.equal(start(`https://youtu.be/${ID}`), undefined);
});

test("what Obsidian's pattern reads as a broken player is not embedded", () => {
  // Its pattern takes the first path word as the ID ("shorts", "live"), which
  // gives the player /embed/shorts; an 11-character ID is required here.
  for (const link of [
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/playlist?list=PL4cUxeGkcC9gZD-Tvwfod2gaISzfRiP9d`,
    `https://www.youtube.com/embed/videoseries?list=PL4cUxeGkcC9gZD-Tvwfod2gaISzfRiP9d`,
    `https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw`,
    `https://www.youtube.com/@GoogleDevelopers`,
    `https://www.youtube.com/c/GoogleDevelopers`,
    `https://www.youtube.com/user/GoogleDevelopers`,
    `https://www.youtube.com/watch/${ID}`,
    `https://www.youtube.com/anything?v=${ID}`,
    `https://youtu.be/embed/${ID}`,
  ]) {
    assert.equal(parseWebEmbed(link), undefined, link);
  }
});

test("hosts Obsidian's pattern does not match are not embedded", () => {
  for (const link of [
    `https://music.youtube.com/watch?v=${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://youtube-nocookie.com/embed/${ID}`,
    `https://studio.youtube.com/watch?v=${ID}`,
    `https://youtube.co/watch?v=${ID}`,
  ]) {
    assert.equal(parseWebEmbed(link), undefined, link);
  }
});

test("a malformed ID, a lookalike host or a hostile URL is refused", () => {
  for (const link of [
    "https://www.youtube.com/watch?v=short",
    `https://www.youtube.com/watch?v=${ID}x`,
    `https://www.youtube.com/watch?v=${ID.slice(0, 10)}`,
    "https://www.youtube.com/watch?v=aaaaaaaaaa!",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=",
    `https://www.youtube.com/embed/${ID}/extra`,
    `https://www.youtube.com.evil.test/watch?v=${ID}`,
    `https://evil.test/youtube.com/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    `https://youtu.be.evil.test/${ID}`,
    `https://user:pw@www.youtube.com/watch?v=${ID}`,
    `https://user@youtu.be/${ID}`,
    `https://www.youtube.com:8443/watch?v=${ID}`,
    `javascript:alert(1)//youtube.com/watch?v=${ID}`,
    `data:text/html,youtube.com/watch?v=${ID}`,
    `ftp://youtu.be/${ID}`,
    `//youtu.be/${ID}`,
    `youtu.be/${ID}`,
    "not a url",
    "",
  ]) {
    assert.equal(parseWebEmbed(link), undefined, link);
  }
});

const TWEET = "1590000000000000000";
const tweet = {
  kind: "tweet",
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
    assert.deepEqual(parseWebEmbed(link), tweet, link);
  }
  assert.deepEqual(parseWebEmbed("https://twitter.com/jack/status/20"), {
    kind: "tweet",
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
    assert.equal(parseWebEmbed(link), undefined, link);
  }
});

test("the providers Online Videos used to card are no longer parsed", () => {
  for (const link of [
    "https://www.bilibili.com/video/BV1DRHU6LELy",
    "https://www.bilibili.com/video/av170001?p=2",
    "https://m.bilibili.com/video/av170001",
    "https://www.bilibili.com/bangumi/play/ep409506",
    "https://www.bilibili.com/bangumi/play/ss40154",
    "https://space.bilibili.com/2",
    "https://m.bilibili.com/space/2",
    "https://live.bilibili.com/3",
    "https://huggingface.co/google/gemma-2-2b",
    "https://huggingface.co/gpt2",
    "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl",
    "https://open.spotify.com/episode/11dFghVXANMlKmJXsNCbNl",
    "https://soundcloud.com/forss/flickermood",
    "https://soundcloud.com/forss/sets/soulhack",
    "https://www.npmjs.com/package/lodash",
    "https://www.npmjs.com/package/@types/node/v/22.0.0",
    "https://vimeo.com/22439234",
    "https://player.vimeo.com/video/22439234",
  ]) {
    assert.equal(parseWebEmbed(link), undefined, link);
  }
});
