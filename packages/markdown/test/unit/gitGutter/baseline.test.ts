import test from "node:test";
import assert from "node:assert/strict";
import { BaselineSource } from "../../../src/plugins/gitGutter/baseline";
import type { Endpoint } from "../../../src/shared/rpc/endpoint";

type Answer = Record<string, unknown> | Error;

/** An editor-side endpoint whose `baseline` answers come from `answers`. */
function editor(answers: Answer[]) {
  const asked: unknown[] = [];
  const warnings: string[] = [];
  const rpc = {
    async call(_protocol: unknown, method: string, params: unknown) {
      assert.equal(method, "baseline");
      asked.push(params);
      const answer = answers.shift();
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
  } as unknown as Endpoint;
  const logger = { warn: (message: string) => void warnings.push(message) };
  return { host: { rpc, logger }, asked, warnings };
}

test("P12: an unchanged baseline asks for no recompute and keeps the text", async () => {
  const { host, asked } = editor([
    { status: "ok", text: "old\n", label: "HEAD (abc1234)", identity: "h-1" },
    { status: "unchanged", identity: "h-1" },
    { status: "ok", text: "new\n", label: "HEAD (def5678)", identity: "h-2" },
  ]);
  const source = new BaselineSource(host, "HEAD");
  assert.equal(await source.refresh(), true);
  assert.equal(source.text, "old\n");
  assert.equal(await source.refresh(), false);
  assert.equal(source.text, "old\n");
  assert.equal(source.status, "ok");
  assert.equal(await source.refresh(), true);
  assert.equal(source.text, "new\n");
  assert.equal(source.label, "HEAD (def5678)");
  assert.deepEqual(asked, [
    { ref: "HEAD" },
    { ref: "HEAD", known: "h-1" },
    { ref: "HEAD", known: "h-1" },
  ]);
});

test("a note that stopped being tracked forgets the identity", async () => {
  const { host, asked } = editor([
    { status: "ok", text: "a\n", label: "Index", identity: "h-1" },
    { status: "untracked" },
    { status: "ok", text: "a\n", label: "Index", identity: "h-1" },
  ]);
  const source = new BaselineSource(host, "index");
  await source.refresh();
  assert.equal(await source.refresh(), true);
  assert.equal(source.status, "untracked");
  assert.equal(source.text, undefined);
  assert.equal(await source.refresh(), true);
  assert.deepEqual(asked[2], { ref: "index" });
});

test("an unchanged answer for another baseline is not trusted", async () => {
  const { host } = editor([
    { status: "ok", text: "a\n", identity: "h-1" },
    { status: "unchanged", identity: "h-9" },
  ]);
  const source = new BaselineSource(host, "HEAD");
  await source.refresh();
  assert.equal(await source.refresh(), true);
  assert.equal(source.status, "unavailable");
  assert.equal(source.text, undefined);
});

test("a failed request is unavailable; an overtaken or stopped one changes nothing", async () => {
  const { host, warnings } = editor([new Error("gone")]);
  const source = new BaselineSource(host, "HEAD");
  assert.equal(await source.refresh(), true);
  assert.equal(source.status, "unavailable");
  assert.deepEqual(warnings, ["Git baseline unavailable"]);

  const late = editor([
    { status: "ok", text: "first\n", identity: "h-1" },
    { status: "ok", text: "second\n", identity: "h-2" },
  ]);
  const raced = new BaselineSource(late.host, "HEAD");
  const first = raced.refresh();
  const second = raced.refresh();
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.equal(raced.text, "second\n");

  const stopped = new BaselineSource(
    editor([{ status: "ok", text: "x\n", identity: "h-1" }]).host,
    "HEAD",
  );
  const pending = stopped.refresh();
  stopped.stop();
  assert.equal(await pending, false);
  assert.equal(stopped.text, undefined);
});
