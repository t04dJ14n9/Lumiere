import test from "node:test";
import assert from "node:assert/strict";
import { enhanceEmbeds } from "../../../src/plugins/embeds/post-process";
import type {
  RenderPass,
  RenderService,
} from "../../../src/plugins/render/api";
import type { Resource, Resources } from "../../../src/plugins/resources/api";

/** As much of an element as an image embed touches. */
class FakeElement {
  tagName = "SPAN";
  dataset: Record<string, string> = {};
  className = "";
  title = "";
  innerHTML = "";
  private _textContent = "";
  get textContent(): string {
    return this._textContent;
  }
  set textContent(value: string) {
    this._textContent = value;
    for (const child of this.children) {
      child.parentNode = null;
      child.parentElement = null;
    }
    this.children = [];
  }
  type = "";
  src = "";
  alt = "";
  decoding = "";
  width = 0;
  height = 0;
  parentNode: FakeElement | null = null;
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  private readonly classes = new Set<string>();
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<
    string,
    Array<(event?: unknown) => void>
  >();
  classList = {
    add: (...tokens: string[]) => tokens.forEach((t) => this.classes.add(t)),
    remove: (...tokens: string[]) =>
      tokens.forEach((t) => this.classes.delete(t)),
    contains: (token: string) => this.classes.has(token),
  };
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  addEventListener(type: string, listener: (event?: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  removeEventListener(): void {}
  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) {
      child.parentNode = null;
      child.parentElement = null;
    }
    this.children = [...nodes];
    for (const child of this.children) {
      child.parentNode = this;
      child.parentElement = this;
    }
  }
  append(...nodes: FakeElement[]): void {
    for (const child of nodes) {
      child.parentNode = this;
      child.parentElement = this;
      this.children.push(child);
    }
  }
  after(node: FakeElement): void {
    const parent = this.parentElement;
    if (!parent) {
      return;
    }
    const index = parent.children.indexOf(this);
    parent.children.splice(index + 1, 0, node);
    node.parentNode = parent;
    node.parentElement = parent;
  }
  replaceWith(node: FakeElement): void {
    const parent = this.parentElement;
    if (!parent) {
      return;
    }
    const index = parent.children.indexOf(this);
    parent.children[index] = node;
    node.parentNode = parent;
    node.parentElement = parent;
    this.parentNode = null;
    this.parentElement = null;
  }
  remove(): void {
    const parent = this.parentElement;
    if (!parent) {
      return;
    }
    parent.children = parent.children.filter((child) => child !== this);
    this.parentNode = null;
    this.parentElement = null;
  }
}

class FakeImageElement extends FakeElement {
  override tagName = "IMG";
}

function installFakeDom(): () => void {
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = {
    document: globals.document,
    HTMLImageElement: globals.HTMLImageElement,
  };
  globals.HTMLImageElement = FakeImageElement;
  globals.document = {
    createElement: (tag: string) =>
      tag === "img" ? new FakeImageElement() : new FakeElement(),
  };
  return () => Object.assign(globals, saved);
}

function passOf(nodes: FakeElement[]): RenderPass {
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

function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function assertFailedImageSurface(node: FakeElement): void {
  assert.ok(node.classList.contains("unresolved-embed"));
  assert.equal(node.textContent, "failed to fetch image");
  assert.equal(
    node.children.some(
      (child) =>
        child.tagName === "IMG" ||
        child.tagName === "BUTTON" ||
        child.classList.contains("embed-actions") ||
        child.className === "embed-actions",
    ),
    false,
    "no img or action controls on a failed image",
  );
  assert.equal(node.classList.contains("image-embed"), false);
}

test("an embed whose file was missing shows it in place once the file is there", async () => {
  const restoreDom = installFakeDom();
  try {
    const arrived = new Set<string>();
    const loads: string[] = [];
    const resources: Resources = {
      async load(target: string): Promise<Resource> {
        loads.push(target);
        if (!arrived.has(target)) {
          throw new Error("Resource not found");
        }
        const source = `file:///vault/${target}`;
        return { kind: "image", source, url: `${source}?v=1` };
      },
    };
    const sketch = new FakeElement();
    sketch.dataset = { resource: "Sketch.sketch.svg", wiki: "true" };
    const photo = new FakeImageElement();
    photo.dataset = { resource: "photo.png" };
    photo.title = "The plan";
    const embeds = enhanceEmbeds({
      pass: passOf([sketch, photo]),
      render: { trusted: true } as unknown as RenderService,
      resources,
      open: () => {},
    });
    await settled();
    assertFailedImageSurface(sketch);
    assertFailedImageSurface(photo);

    arrived.add("Sketch.sketch.svg");
    embeds.retryMissing();
    await settled();
    assert.deepEqual(loads.splice(0), [
      "Sketch.sketch.svg",
      "photo.png",
      "Sketch.sketch.svg",
      "photo.png",
    ]);
    assert.equal(sketch.classList.contains("unresolved-embed"), false);
    assert.equal(sketch.title, "");
    assert.equal(
      sketch.children.find((child) => child.tagName === "IMG")?.src,
      "file:///vault/Sketch.sketch.svg?v=1",
    );
    assert.ok(photo.classList.contains("unresolved-embed"), "still missing");
    assert.equal(photo.textContent, "failed to fetch image");

    arrived.add("photo.png");
    embeds.retryMissing();
    await settled();
    assert.deepEqual(loads.splice(0), ["photo.png"], "only what was missing");
    assert.equal(photo.classList.contains("unresolved-embed"), false);
    assert.equal(photo.title, "The plan", "its own title, not the error");
    assert.equal(photo.src, "file:///vault/photo.png?v=1");

    embeds.retryMissing();
    await settled();
    assert.deepEqual(loads, []);
    embeds.dispose();
  } finally {
    restoreDom();
  }
});

test("a remote https image that fails to load shows unresolved-embed without actions", async () => {
  const restoreDom = installFakeDom();
  try {
    const node = new FakeElement();
    node.dataset = {
      resource: "https://example.com/broken.png",
      wiki: "true",
    };
    enhanceEmbeds({
      pass: passOf([node]),
      render: { trusted: true } as unknown as RenderService,
      resources: {
        async load(): Promise<Resource> {
          throw new Error("should not load remote");
        },
      },
      open: () => {},
    });
    await settled();
    const image = node.children.find((child) => child.tagName === "IMG");
    assert.ok(image, "remote image was mounted before its error");
    assert.equal(image.src, "https://example.com/broken.png");
    image.dispatch("error");
    assertFailedImageSurface(node);
    assert.equal(node.children.length, 0, "img and embed-actions are cleared");
  } finally {
    restoreDom();
  }
});

test("a markdown img remote that fails replaces the image-embed host", async () => {
  const restoreDom = installFakeDom();
  try {
    const root = new FakeElement();
    const photo = new FakeImageElement();
    photo.dataset = { resource: "https://cdn.example/gone.jpg" };
    root.append(photo);
    enhanceEmbeds({
      pass: passOf([photo]),
      render: { trusted: true } as unknown as RenderService,
      resources: {
        async load(): Promise<Resource> {
          throw new Error("should not load remote");
        },
      },
      open: () => {},
    });
    await settled();
    assert.equal(photo.src, "https://cdn.example/gone.jpg");
    const host = photo.parentElement;
    assert.ok(host, "markdown img is wrapped in an image-embed host");
    assert.ok(host.classList.contains("image-embed"));
    photo.dispatch("error");
    assertFailedImageSurface(host);
    assert.equal(host.children.length, 0);
  } finally {
    restoreDom();
  }
});

test("a missing note embed keeps the could-not-be-found wording", async () => {
  const restoreDom = installFakeDom();
  try {
    const note = new FakeElement();
    note.dataset = { resource: "MissingNote", wiki: "true" };
    enhanceEmbeds({
      pass: passOf([note]),
      render: { trusted: true } as unknown as RenderService,
      resources: {
        async load(): Promise<Resource> {
          throw new Error("Resource not found");
        },
      },
      open: () => {},
    });
    await settled();
    assert.ok(note.classList.contains("unresolved-embed"));
    assert.equal(note.textContent, '"MissingNote" could not be found.');
  } finally {
    restoreDom();
  }
});
