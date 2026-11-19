import test from "node:test";
import assert from "node:assert/strict";
import { enhanceEmbeds } from "../../../src/plugins/embeds/post-process";
import { forgetEmbedResources } from "../../../src/plugins/embeds/resource-cache";
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

/**
 * A void element: the browser keeps text assigned to an <img> but never
 * paints it, so `visibleText` skips it. A failure written into the image
 * itself is therefore invisible here, as it is on a page.
 */
class FakeImageElement extends FakeElement {
  override tagName = "IMG";
}

/** The text a reader can see in `node` and below, as the browser paints it. */
function visibleText(node: FakeElement): string {
  if (node.tagName === "IMG") {
    return "";
  }
  return node.textContent + node.children.map(visibleText).join("");
}

function hasImage(node: FakeElement): boolean {
  return (
    node.tagName === "IMG" || node.children.some((child) => hasImage(child))
  );
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

/** An image that was there but would not load: remote, or found and broken. */
function assertFailedImageSurface(node: FakeElement): void {
  assertUnresolved(node, "failed to fetch image");
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

/** `surface` is something a reader sees, in the unresolved-embed style. */
function assertUnresolved(surface: FakeElement, message: string): void {
  assert.ok(surface.classList.contains("unresolved-embed"));
  assert.equal(surface.tagName === "IMG", false, "an <img> shows no text");
  assert.equal(visibleText(surface), message);
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
    const page = new FakeElement();
    page.append(photo);
    const embeds = enhanceEmbeds({
      pass: passOf([sketch, photo]),
      render: { trusted: true } as unknown as RenderService,
      resources,
      open: () => {},
    });
    await settled();
    assertUnresolved(sketch, "“Sketch.sketch.svg” could not be found.");
    // The <img> cannot show text: a block takes its place on the page.
    assert.equal(hasImage(page), false);
    assertUnresolved(page.children[0]!, "“photo.png” could not be found.");

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
    assert.equal(hasImage(page), false, "still missing");
    assertUnresolved(page.children[0]!, "“photo.png” could not be found.");

    arrived.add("photo.png");
    embeds.retryMissing();
    await settled();
    assert.deepEqual(loads.splice(0), ["photo.png"], "only what was missing");
    assert.equal(hasImage(page), true, "the image is back");
    assert.doesNotMatch(visibleText(page), /could not be found/);
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

test("a missing Markdown image says so where the image was, and the image returns on dispose", async () => {
  const restoreDom = installFakeDom();
  try {
    const page = new FakeElement();
    const photo = new FakeImageElement();
    photo.dataset = { resource: "attachments/missing.png" };
    page.append(photo);
    const embeds = enhanceEmbeds({
      pass: passOf([photo]),
      render: { trusted: true } as unknown as RenderService,
      resources: {
        async load(): Promise<Resource> {
          throw new Error("Resource not found");
        },
      },
      open: () => {},
    });
    await settled();
    assert.equal(page.children.length, 1);
    const [message] = page.children;
    assert.equal(message!.tagName, "SPAN");
    assert.equal(message!.className, "file-embed", "styled as ![[…]] is");
    assertUnresolved(message!, "“attachments/missing.png” could not be found.");
    assert.equal(message!.title, "Error: Resource not found");
    assert.equal(hasImage(page), false);

    embeds.dispose();
    assert.deepEqual(page.children, [photo]);
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

test("an extensionless remote markdown img still says failed to fetch after wrap", async () => {
  const restoreDom = installFakeDom();
  try {
    const root = new FakeElement();
    const photo = new FakeImageElement();
    // No image extension — mediaKind is undefined; resolve still uses kind "image".
    photo.dataset = { resource: "https://cdn.example/photo?id=1" };
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
    assert.equal(photo.src, "https://cdn.example/photo?id=1");
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

test("a note that embeds itself says so, not that it could not be found", async () => {
  const restoreDom = installFakeDom();
  try {
    const note = new FakeElement();
    note.dataset = { resource: "Other", wiki: "true" };
    // Rendered inside Other's own embed: Other is in the pass's ancestry.
    const pass = { ...passOf([note]), ancestry: ["file:///vault/Other.md#"] };
    enhanceEmbeds({
      pass,
      render: { trusted: true } as unknown as RenderService,
      resources: {
        load: async () => ({
          kind: "note",
          source: "file:///vault/Other.md",
          url: "file:///vault/Other.md",
          text: "![[Other]]",
        }),
      },
      open: () => {},
    });
    await settled();
    assertUnresolved(note, "“Other” embeds itself, so it is not shown again.");
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
    assertUnresolved(note, "“MissingNote” could not be found.");
  } finally {
    restoreDom();
  }
});

test("an embedded image shows its new version when its file changes", async () => {
  const restoreDom = installFakeDom();
  try {
    let version = 1;
    const loads: string[] = [];
    const resources: Resources = {
      async load(target: string): Promise<Resource> {
        loads.push(target);
        const source = `file:///vault/${target}`;
        return { kind: "image", source, url: `${source}?v=${version}` };
      },
    };
    const photo = new FakeElement();
    photo.dataset = { resource: "photo.png", wiki: "true" };
    const other = new FakeElement();
    other.dataset = { resource: "other.png", wiki: "true" };
    const embeds = enhanceEmbeds({
      pass: passOf([photo, other]),
      render: { trusted: true } as unknown as RenderService,
      resources,
      open: () => {},
    });
    await settled();
    loads.length = 0;
    version = 2;
    // As the plugin does: what embeds resolved is dropped first.
    forgetEmbedResources(resources);
    embeds.reload(new Set(["file:///vault/photo.png"]));
    await settled();
    assert.deepEqual(
      loads,
      ["photo.png"],
      "only the embed of the changed file",
    );
    const images = photo.children.filter((child) => child.tagName === "IMG");
    assert.equal(images.length, 1);
    assert.equal(images[0]!.src, "file:///vault/photo.png?v=2");
    assert.equal(
      photo.children.filter((child) => child.className === "embed-actions")
        .length,
      1,
      "the old image's controls went with it",
    );
    embeds.dispose();
  } finally {
    restoreDom();
  }
});

test("an embedded note shows its new text, and only the latest of two changes lands", async () => {
  const restoreDom = installFakeDom();
  try {
    const answers: ((text: string) => void)[] = [];

    const resources: Resources = {
      load: () =>
        new Promise<Resource>((resolve) =>
          answers.push((body) =>
            resolve({
              kind: "note",
              source: "file:///vault/Other.md",
              url: "file:///vault/Other.md",
              text: body,
            }),
          ),
        ),
    };
    const disposed: string[] = [];
    const render = {
      trusted: true,
      async into(content: FakeElement, source: string) {
        content.textContent = source;
        return { dispose: async () => void disposed.push(source) };
      },
    } as unknown as RenderService;
    const note = new FakeElement();
    note.dataset = { resource: "Other", wiki: "true" };
    const embeds = enhanceEmbeds({
      pass: passOf([note]),
      render,
      resources,
      open: () => {},
    });
    answers.shift()!("First version");
    await settled();
    assert.match(visibleText(note), /First version/);

    const changed = new Set(["file:///vault/Other.md"]);
    embeds.reload(changed);
    embeds.reload(changed);
    const [stale, latest] = answers.splice(0);
    latest!("Third version");
    await settled();
    stale!("Second version");
    await settled();
    assert.match(visibleText(note), /Third version/);
    assert.doesNotMatch(visibleText(note), /First|Second/);
    assert.deepEqual(disposed, ["First version"]);
    embeds.dispose();
    assert.deepEqual(disposed, ["First version", "Third version"]);
  } finally {
    restoreDom();
  }
});
