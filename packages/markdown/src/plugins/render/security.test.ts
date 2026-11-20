import test from "node:test";
import assert from "node:assert/strict";
import { insertRenderedHtml } from "./security";

/** Just enough DOM: elements with attributes, found by tag or `[src]`. */
class FakeElement {
  readonly attributes = new Map<string, string>();
  loading = "";
  removed = false;
  constructor(readonly tag: string) {}
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  remove(): void {
    this.removed = true;
  }
}

class FakeFragment {
  constructor(readonly children: FakeElement[]) {}
  querySelectorAll(selector: string): FakeElement[] {
    const live = this.children.filter((child) => !child.removed);
    return selector === "[src]"
      ? live.filter((child) => child.attributes.has("src"))
      : live.filter((child) => child.tag === selector);
  }
}

function page(parse: (html: string) => FakeElement[]) {
  const inserted: { tag: string; sandbox: string | null }[][] = [];
  const container = {
    ownerDocument: {
      createElement: (tag: string) => {
        assert.equal(tag, "template");
        const template = {
          content: new FakeFragment([]),
          set innerHTML(html: string) {
            template.content = new FakeFragment(parse(html));
          },
        };
        return template;
      },
    },
    // What the page holds the moment the rendered nodes go in.
    replaceChildren(content: FakeFragment) {
      inserted.push(
        content.querySelectorAll("iframe").map((frame) => ({
          tag: frame.tag,
          sandbox: frame.getAttribute("sandbox"),
        })),
      );
    },
  };
  return { container: container as unknown as HTMLElement, inserted };
}

function frame(src: string): FakeElement {
  const element = new FakeElement("iframe");
  element.setAttribute("src", src);
  return element;
}

test("a rendered iframe is sandboxed before it is in the page", () => {
  const f = page(() => [frame("https://example.com/embed")]);
  insertRenderedHtml(f.container, "<iframe></iframe>", true);
  assert.deepEqual(f.inserted, [
    [
      {
        tag: "iframe",
        sandbox: "allow-scripts allow-same-origin allow-presentation",
      },
    ],
  ]);
});

test("an untrusted note's iframes and remote sources never reach the page", () => {
  const image = new FakeElement("img");
  image.setAttribute("src", "https://example.com/a.png");
  const f = page(() => [frame("https://example.com/embed"), image]);
  insertRenderedHtml(f.container, "<iframe></iframe><img>", false);
  assert.deepEqual(f.inserted, [[]]);
  assert.equal(image.getAttribute("src"), null);
});
