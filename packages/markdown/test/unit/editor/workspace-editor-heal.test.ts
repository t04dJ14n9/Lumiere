import assert from "node:assert/strict";
import test from "node:test";
import {
  routesMarkdownThroughText,
  usesTextFirstRoute,
} from "../../../src/host/workspace-editor-heal";
import { MARKDOWN_WORKSPACE_EDITOR_KEY } from "../../../src/shared/editor-provider";

function memento(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial));
  return {
    values,
    get<T>(key: string, fallback: T) {
      return (values.has(key) ? values.get(key) : fallback) as T;
    },
    async update(key: string, value: unknown) {
      values.set(key, value);
    },
  };
}

test("only a workspace the old command recorded uses the text-first route", () => {
  assert.equal(
    usesTextFirstRoute(
      memento({ [MARKDOWN_WORKSPACE_EDITOR_KEY]: true }) as never,
    ),
    true,
  );
  assert.equal(usesTextFirstRoute(memento() as never), false);
  assert.equal(usesTextFirstRoute(undefined), false);
});

test('"*.md": "default" alone is an opt-out, never healed into the route', () => {
  const state = memento();
  assert.equal(usesTextFirstRoute(state as never), false);
  assert.equal(state.values.has(MARKDOWN_WORKSPACE_EDITOR_KEY), false);
  // The associations still say Markdown opens as text; that is the opt-out.
  assert.equal(
    routesMarkdownThroughText({ "*.md": "default", "*.markdown": "default" }),
    true,
  );
  assert.equal(
    routesMarkdownThroughText({ "*.md": "lumiere.markdown.editor" }),
    false,
  );
});
