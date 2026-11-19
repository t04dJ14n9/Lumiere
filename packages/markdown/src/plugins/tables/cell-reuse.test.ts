import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { parseTable } from "../../markdown/tables/model";
import type { RenderPass, RenderService } from "../render/api";
import { TableContent } from "./content";
import { TableGrid } from "./grid";

/** Just enough of the DOM for a table grid to build its cells. */
class FakeElement {
  className = "";
  children: FakeElement[] = [];
  parent: FakeElement | undefined;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  isConnected = true;
  constructor(readonly tagName: string) {}
  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parent?.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(): void {
    for (const child of this.children) {
      child.parent = undefined;
    }
    this.children = [];
  }
  setAttribute(): void {}
  createTHead(): FakeElement {
    const head = new FakeElement("thead");
    this.append(head);
    return head;
  }
  createTBody(): FakeElement {
    const body = new FakeElement("tbody");
    this.append(body);
    return body;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const name = selector.slice(1);
    return this.children.flatMap((child) => [
      ...(child.className === name ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function withDocument(run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    value: { createElement: (tag: string) => new FakeElement(tag) },
    configurable: true,
  });
  try {
    run();
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, "document", previous);
    } else {
      delete (globalThis as { document?: unknown }).document;
    }
  }
}

const before = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| - [ ] task | 4 |";
const after =
  "| a | b |\n| --- | --- |\n| new | row |\n| 1 | 2 |\n| - [ ] task | 4 |";

/** A grid over `note`, rendering through a real TableContent into fake passes. */
function mountedGrid(note: string) {
  let state = EditorState.create({ doc: note });
  const view = {
    get state() {
      return state;
    },
    posAtDOM: () => 0,
    requestMeasure() {},
  } as unknown as EditorView;
  const renders: { source: string; pass: RenderPass }[] = [];
  const render: RenderService = {
    async into(container, source, context) {
      const pass = {
        source,
        container,
        sourceLine: context?.sourceLine ?? 0,
        ancestry: [],
        renderKey: source,
        measure() {},
        onDispose() {},
        dispose: async () => {},
      } satisfies RenderPass;
      renders.push({ source, pass });
      return pass;
    },
  };
  const content = new TableContent(view, render, {
    error() {},
  } as never);
  const grid = new TableGrid(
    new FakeElement("div") as unknown as HTMLElement,
    view,
    { kind: "Table", from: 0, to: note.length, source: note },
    {
      renderContent: (element, source, offset) =>
        content.renderContent(element, source, offset),
      disposeContent: (element) => content.disposeContent(element),
      renderedSource: (element) => content.renderedSource(element),
      moveContent: (element, offset) => content.moveContent(element, offset),
    },
  );
  return {
    grid,
    renders,
    setNote(text: string) {
      state = EditorState.create({ doc: text });
      grid.block = { kind: "Table", from: 0, to: text.length, source: text };
      grid.model = parseTable(text)!;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a new row renders only its own cells; the others keep their rendering", async () => {
  let mounted!: ReturnType<typeof mountedGrid>;
  withDocument(() => {
    mounted = mountedGrid(before);
    mounted.grid.render();
  });
  await settle();
  assert.equal(mounted.renders.length, 6);
  const kept = mounted.grid.contentElement({ row: 2, column: 0 });
  withDocument(() => {
    mounted.setNote(after);
    mounted.grid.render();
  });
  await settle();
  assert.deepEqual(
    mounted.renders.slice(6).map((render) => render.source),
    ["new", "row"],
  );
  // The same rendered element now sits one row lower.
  assert.equal(mounted.grid.contentElement({ row: 3, column: 0 }), kept);
});

test("a kept cell's render pass is moved to the cell's new source line", async () => {
  let mounted!: ReturnType<typeof mountedGrid>;
  withDocument(() => {
    mounted = mountedGrid(before);
    mounted.grid.render();
  });
  await settle();
  const task = mounted.renders.find((r) => r.source === "- [ ] task")!;
  assert.equal(task.pass.sourceLine, 3);
  withDocument(() => {
    mounted.setNote(after);
    mounted.grid.render();
  });
  // Tasks read the line when the box is clicked: it must be the new one.
  assert.equal(task.pass.sourceLine, 4);
});

test("a cell moved while its render is still pending gets the new line too", async () => {
  let mounted!: ReturnType<typeof mountedGrid>;
  withDocument(() => {
    mounted = mountedGrid(before);
    mounted.grid.render();
    mounted.setNote(after);
    mounted.grid.render();
  });
  await settle();
  const passes = mounted.renders.filter((r) => r.source === "- [ ] task");
  assert.equal(passes.length, 1);
  assert.equal(passes[0]!.pass.sourceLine, 4);
});

test("a cell with a footnote is rendered again: its number depends on its place", async () => {
  const footnote = "| a |\n| --- |\n| x[^1] |";
  let mounted!: ReturnType<typeof mountedGrid>;
  withDocument(() => {
    mounted = mountedGrid(footnote);
    mounted.grid.render();
    mounted.setNote("| a |\n| --- |\n| y |\n| x[^1] |");
    mounted.grid.render();
  });
  await settle();
  assert.deepEqual(
    mounted.renders.map((render) => render.source),
    ["a", "x[^1]", "y", "x[^1]"],
  );
});
