import test from "node:test";
import assert from "node:assert/strict";
import { TWEET_MAX_HEIGHT, TWEET_MIN_HEIGHT } from "./player";
import { tweetResizeHeight, type FrameMessage } from "./tweet-height";

const frame = {};
const ORIGIN = "https://platform.twitter.com";
const resize = (height: unknown, extra: Record<string, unknown> = {}) => ({
  "twttr.embed": {
    method: "twttr.private.resize",
    params: [{ width: 550, height }],
    jsonrpc: "2.0",
    id: 7,
    ...extra,
  },
});
/** A message from the frame itself, unless `overrides` says otherwise. */
const accept = (data: unknown, overrides: Partial<FrameMessage> = {}) =>
  tweetResizeHeight(
    { source: frame, origin: ORIGIN, data, ...overrides },
    frame,
  );

test("the widget's resize request sets the frame's height", () => {
  assert.equal(accept(resize(612)), 612);
  assert.equal(accept(resize(612.4)), 612);
});

test("a message from another window or origin is ignored", () => {
  const data = resize(612);
  assert.equal(accept(data, { source: {} }), undefined);
  assert.equal(accept(data, { source: null }), undefined);
  assert.equal(accept(data, { source: undefined }), undefined);
  assert.equal(accept(data, { source: globalThis }), undefined);
  for (const origin of [
    "https://evil.test",
    "https://platform.twitter.com.evil.test",
    "https://twitter.com",
    "http://platform.twitter.com",
    "https://platform.twitter.com:8443",
    "null",
    "",
    "vscode-webview://abc",
  ]) {
    assert.equal(accept(data, { origin }), undefined, origin);
  }
});

test("a frame that is gone answers no message", () => {
  const message = { source: frame, origin: ORIGIN, data: resize(612) };
  assert.equal(tweetResizeHeight(message, null), undefined);
  assert.equal(tweetResizeHeight(message, undefined), undefined);
});

test("only a resize request of the right shape counts", () => {
  for (const data of [
    undefined,
    null,
    "twttr.private.resize",
    JSON.stringify(resize(612)),
    42,
    [],
    {},
    { "twttr.embed": null },
    { "twttr.embed": [] },
    { "twttr.embed": "x" },
    { "twttr.embed": { method: "twttr.private.resize" } },
    { "twttr.embed": { method: "twttr.private.resize", params: [] } },
    { "twttr.embed": { method: "twttr.private.resize", params: {} } },
    { "twttr.embed": { method: "twttr.private.resize", params: [null] } },
    { "twttr.embed": { method: "twttr.private.resize", params: [612] } },
    { "twttr.embed": { method: "twttr.private.resize", params: [{}] } },
    {
      "twttr.embed": {
        method: "twttr.private.other",
        params: [{ height: 612 }],
      },
    },
    {
      "twttr.embed": {
        method: "twttr.private.resize ",
        params: [{ height: 612 }],
      },
    },
    { "twttr.embed": { params: [{ height: 612 }] } },
    { other: resize(612)["twttr.embed"] },
    resize("612"),
    resize(null),
    resize(NaN),
    resize(Infinity),
    resize(-Infinity),
    resize(0),
    resize(-10),
    resize([612]),
    resize({ valueOf: () => 612 }),
  ]) {
    assert.equal(accept(data), undefined, JSON.stringify(data));
  }
});

test("the first parameter is the one read, and extra keys are tolerated", () => {
  assert.equal(
    accept({
      "twttr.embed": {
        method: "twttr.private.resize",
        params: [{ height: 300, width: 550, extra: true }, { height: 900 }],
        jsonrpc: "2.0",
        id: 1,
        unknown: "field",
      },
      other: 1,
    }),
    300,
  );
});

test("the height is clamped to the floor and the ceiling", () => {
  assert.equal(accept(resize(1)), TWEET_MIN_HEIGHT);
  assert.equal(accept(resize(1001)), TWEET_MAX_HEIGHT);
  assert.equal(accept(resize(1e12)), TWEET_MAX_HEIGHT);
  assert.equal(accept(resize(TWEET_MAX_HEIGHT)), TWEET_MAX_HEIGHT);
});
