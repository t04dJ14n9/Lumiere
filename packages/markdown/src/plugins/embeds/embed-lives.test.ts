import assert from "node:assert/strict";
import test from "node:test";
import { EmbedLives } from "./embed-lives";

test("releasing an embed aborts its listeners and runs its teardowns, latest first", () => {
  const lives = new EmbedLives<string>();
  const order: string[] = [];
  const signal = lives.signal("a");
  lives.onRelease("a", () => order.push("first"));
  lives.onRelease("a", () => order.push("second"));
  lives.onRelease("b", () => order.push("other"));
  lives.release("a");
  assert.equal(signal.aborted, true);
  assert.deepEqual(order, ["second", "first"]);
  assert.equal(lives.signal("a").aborted, false, "shown again, a new life");
  lives.releaseAll();
  assert.deepEqual(order, ["second", "first", "other"]);
});

test("embeds are found by the file they show", () => {
  const lives = new EmbedLives<string>();
  lives.setSource("a", "file:///vault/B.md");
  lives.setSource("b", "file:///vault/C.png");
  lives.setSource("c", "file:///vault/B.md");
  lives.signal("d");
  assert.deepEqual(lives.showing(new Set(["file:///vault/B.md"])), ["a", "c"]);
  lives.release("a");
  assert.deepEqual(lives.showing(new Set(["file:///vault/B.md"])), ["c"]);
});
