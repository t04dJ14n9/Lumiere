import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "@workshop/core";
import { provideHostServices } from "../../../src/shared/host";
import type { EditorPanel } from "../../../src/plugins/editor/api";
import { vimHost } from "../../../src/plugins/vim/host";
import { fakeHost } from "../../support/vscode-fake";

type Listener = (status: { text: string }) => void;

function panel(id: string, active: () => boolean) {
  const listeners: Listener[] = [];
  const value = {
    id,
    active,
    rpc: {
      on: (_protocol: unknown, _method: string, listener: Listener) => {
        listeners.push(listener);
        return () => listeners.splice(listeners.indexOf(listener), 1);
      },
    },
  } as unknown as EditorPanel;
  return {
    value,
    send: (text: string) => listeners.forEach((l) => l({ text })),
  };
}

async function start(statusBar: boolean) {
  const shown: (string | undefined)[] = [];
  let created = 0;
  let current = "one";
  const one = panel("one", () => current === "one");
  const two = panel("two", () => current === "two");
  const host = fakeHost({
    views: {
      statusBar,
      status: () => {
        created += 1;
        return {
          show: (text: string) => shown.push(text),
          hide: () => shown.push(undefined),
          dispose: () => {},
        };
      },
    } as never,
  });
  const root = createRoot();
  provideHostServices(root, host);
  const active = () => (current === "one" ? one.value : two.value);
  root.provide("editors", {
    all: () => [one.value, two.value],
    active,
  } as never);
  root.plugin(vimHost);
  await root.settled();
  const activate = (id: string) => {
    current = id;
    root.emit("editor/activeChanged", active());
  };
  return { root, shown, one, two, activate, created: () => created };
}

test("the window status bar shows the active editor's Vim mode", async (t) => {
  const f = await start(true);
  t.after(() => f.root.dispose());
  f.one.send("-- NORMAL --");
  f.two.send("-- INSERT --");
  f.one.send("-- NORMAL --  d");
  f.activate("two");
  assert.deepEqual(f.shown.filter(Boolean), [
    "-- NORMAL --",
    "-- NORMAL --  d",
    "-- INSERT --",
  ]);
});

test("a host without a status bar adds no entry", async (t) => {
  const f = await start(false);
  t.after(() => f.root.dispose());
  f.one.send("-- NORMAL --");
  assert.equal(f.created(), 0);
  assert.deepEqual(f.shown, []);
});
