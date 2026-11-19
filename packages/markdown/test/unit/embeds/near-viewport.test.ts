import test from "node:test";
import assert from "node:assert/strict";
import { enhanceEmbeds } from "../../../src/plugins/embeds/post-process";
import type {
  RenderPass,
  RenderService,
} from "../../../src/plugins/render/api";
import type { Resources } from "../../../src/plugins/resources/api";

/** IntersectionObservers the page made, which the test drives. */
class FakeObserver {
  static made: FakeObserver[] = [];
  readonly observed = new Set<unknown>();
  disconnected = false;
  constructor(
    readonly callback: (entries: unknown[]) => void,
    readonly options: { root?: unknown; rootMargin?: string },
  ) {
    FakeObserver.made.push(this);
  }
  observe(node: unknown): void {
    this.observed.add(node);
  }
  unobserve(node: unknown): void {
    this.observed.delete(node);
  }
  disconnect(): void {
    this.disconnected = true;
    this.observed.clear();
  }
  /** The page scrolled `node` near the visible area. */
  near(node: unknown): void {
    this.callback([{ target: node, isIntersecting: true }]);
  }
}

function embed(resource: string, scroller: unknown) {
  return {
    dataset: { resource, wiki: "true" },
    innerHTML: "",
    title: "",
    getAttribute: () => null,
    removeAttribute: () => {},
    closest: (selector: string) =>
      selector === ".cm-scroller" ? scroller : null,
  };
}

function passOf(nodes: unknown[]): RenderPass {
  return {
    source: "",
    sourceLine: 0,
    ancestry: [],
    renderKey: "",
    documentUri: "file:///vault/Note.md",
    container: { querySelectorAll: () => nodes } as unknown as HTMLElement,
    measure: () => {},
    onDispose: () => {},
    dispose: async () => {},
  } as RenderPass;
}

function withObserver(run: () => void): void {
  const globals = globalThis as Record<string, unknown>;
  const saved = globals.IntersectionObserver;
  globals.IntersectionObserver = FakeObserver;
  FakeObserver.made = [];
  try {
    run();
  } finally {
    globals.IntersectionObserver = saved;
  }
}

test("a note, base or PDF embed far down a note loads when it comes near the screen", () => {
  withObserver(() => {
    const loads: string[] = [];
    // Loads never answer: only which were asked for matters here.
    const resources: Resources = {
      load: (target) => {
        loads.push(target);
        return new Promise(() => {});
      },
    };
    const scroller = {};
    const note = embed("Big#Section", scroller);
    const base = embed("Tasks.base", scroller);
    const pdf = embed("Paper.pdf", scroller);
    const image = embed("photo.png", scroller);
    const embeds = enhanceEmbeds({
      pass: passOf([note, base, pdf, image]),
      render: {} as RenderService,
      resources,
      open: () => {},
    });
    // An image keeps its size from the start; it loads at once.
    assert.deepEqual(loads, ["photo.png"]);
    const [observer] = FakeObserver.made;
    assert.equal(observer?.options.root, scroller);
    assert.match(observer!.options.rootMargin!, /px/);
    observer!.near(base);
    assert.deepEqual(loads, ["photo.png", "Tasks.base"]);
    assert.ok(!observer!.observed.has(base));
    embeds.dispose();
    assert.ok(observer!.disconnected);
  });
});

test("an embed outside an editor's scroller, or without an observer, loads at once", () => {
  withObserver(() => {
    const loads: string[] = [];
    const resources: Resources = {
      load: (target) => {
        loads.push(target);
        return new Promise(() => {});
      },
    };
    // A hover preview's popup, or a container not on the page yet.
    enhanceEmbeds({
      pass: passOf([embed("Big", null)]),
      render: {} as RenderService,
      resources,
      open: () => {},
    });
    assert.deepEqual(loads, ["Big"]);
  });
});
