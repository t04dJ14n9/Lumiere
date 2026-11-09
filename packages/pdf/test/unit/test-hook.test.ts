import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeReact } from "./support/fake-react";
import { loadHook } from "./support/load-hook";

function load(globals: Record<string, unknown>) {
  const stage = { getScrollMetrics: () => ({}) };
  const { react, render } = fakeReact();
  const hook = loadHook(
    "test-hook.ts",
    { react, "./stage-capability": { useStageApi: () => stage } },
    { window: globals },
  ).useExposeStageForTests as () => void;
  return { stage, mount: () => render(hook) };
}

test("the Stage is exposed to the browser specs only when the harness asks", () => {
  const harness: Record<string, unknown> = { __exposeStage: true };
  const asked = load(harness);
  asked.mount();
  assert.equal(harness.__stage, asked.stage);

  const vscode: Record<string, unknown> = {};
  load(vscode).mount();
  assert.equal("__stage" in vscode, false);
});
