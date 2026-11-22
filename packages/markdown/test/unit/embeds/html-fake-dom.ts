/**
 * As much of a DOM as an HTML embed touches, with what a test must see that
 * a real one hides: the order attributes were set in, and every element in a
 * tree. (The browser suite holds the real thing.)
 */
export class FakeNode {
  tagName: string;
  className = "";
  title = "";
  type = "";
  textContent = "";
  innerHTML = "";
  dataset: Record<string, string> = {};
  readonly style = {
    height: "",
    props: {} as Record<string, string>,
    setProperty(name: string, value: string) {
      this.props[name] = value;
    },
  };
  parentElement: FakeNode | null = null;
  children: FakeNode[] = [];
  ownerDocument = fakeDocument();
  /** Attribute names in the order they were set. */
  readonly attributeOrder: string[] = [];
  private readonly attributes = new Map<string, string>();
  private readonly classes = new Set<string>();
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  readonly classList = {
    add: (...tokens: string[]) => tokens.forEach((t) => this.classes.add(t)),
    remove: (...tokens: string[]) =>
      tokens.forEach((t) => this.classes.delete(t)),
    contains: (token: string) =>
      this.classes.has(token) || this.className.split(" ").includes(token),
  };
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
  }
  setAttribute(name: string, value: string): void {
    if (!this.attributes.has(name)) {
      this.attributeOrder.push(name);
    }
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  addEventListener(
    type: string,
    listener: (event: unknown) => void,
    options?: { signal?: AbortSignal },
  ): void {
    const list = this.listeners.get(type) ?? [];
    list.push((event) => {
      if (!options?.signal?.aborted) {
        listener(event);
      }
    });
    this.listeners.set(type, list);
  }
  click(): { defaultPrevented: boolean; propagationStopped: boolean } {
    const event = {
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
      stopPropagation() {
        event.propagationStopped = true;
      },
    };
    for (const listener of this.listeners.get("click") ?? []) {
      listener(event);
    }
    return event;
  }
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: FakeNode[]): void {
    for (const child of this.children) {
      child.parentElement = null;
    }
    this.children = [];
    this.append(...nodes);
  }
  replaceWith(node: FakeNode): void {
    const parent = this.parentElement;
    if (!parent) {
      return;
    }
    parent.children[parent.children.indexOf(this)] = node;
    node.parentElement = parent;
    this.parentElement = null;
  }
}

/** An element the browser never paints the children of. */
export class FakeImage extends FakeNode {
  src = "";
  alt = "";
  decoding = "";
  width = 0;
  height = 0;
  constructor() {
    super("img");
  }
}

export function fakeDocument() {
  return {
    createElement: (tag: string): FakeNode =>
      tag === "img" ? new FakeImage() : new FakeNode(tag),
  };
}

/** Every element at or below `node`. */
export function everyElement(node: FakeNode): FakeNode[] {
  return [node, ...node.children.flatMap(everyElement)];
}

export function elementsOf(node: FakeNode, tag: string): FakeNode[] {
  return everyElement(node).filter(
    (item) => item.tagName === tag.toUpperCase(),
  );
}

/** The text a reader sees at or below `node`. */
export function textOf(node: FakeNode): string {
  return node.tagName === "IMG"
    ? ""
    : node.textContent + node.children.map(textOf).join("");
}

/** Install the fake as the page's `document`; the returned function undoes it. */
export function installFakeDom(): () => void {
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = {
    document: globals["document"],
    HTMLImageElement: globals["HTMLImageElement"],
  };
  globals["HTMLImageElement"] = FakeImage;
  globals["document"] = fakeDocument();
  return () => Object.assign(globals, saved);
}
