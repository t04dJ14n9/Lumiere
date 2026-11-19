import test from "node:test";
import assert from "node:assert/strict";
import type { VideoDetails } from "./protocol";
import { rememberedDetails } from "./webview";

test("a video's details are asked for once and reused by re-rendered blocks", async () => {
  const known = new Map<string, Promise<VideoDetails>>();
  let asked = 0;
  const ask = async (): Promise<VideoDetails> => {
    asked += 1;
    return { title: "A talk" } as VideoDetails;
  };
  await rememberedDetails(known, "youtube:video:x:1", ask);
  await rememberedDetails(known, "youtube:video:x:1", ask);
  assert.equal(asked, 1);
});

test("a failed lookup is asked for again by the next render, not kept for the session", async () => {
  const known = new Map<string, Promise<VideoDetails>>();
  const answers: VideoDetails[] = [{}, { title: "A talk" } as VideoDetails];
  let asked = 0;
  const ask = async () => answers[asked++]!;
  assert.deepEqual(await rememberedDetails(known, "k", ask), {});
  assert.deepEqual(await rememberedDetails(known, "k", ask), {
    title: "A talk",
  });
  await rememberedDetails(known, "k", ask);
  assert.equal(asked, 2);
});
