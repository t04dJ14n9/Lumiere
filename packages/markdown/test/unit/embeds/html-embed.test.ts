import assert from "node:assert/strict";
import test from "node:test";
import {
  HTML_EMBED_DISABLED_NOTE,
  htmlFilename,
  htmlOpenTarget,
  mountHtmlCard,
  type MountHtmlCardOptions,
} from "../../../src/plugins/embeds/html-embed";
import { convertHtmlEmbedBlocks } from "../../../src/plugins/embeds/html-embed-block";
import { enhanceEmbeds } from "../../../src/plugins/embeds/post-process";
import { forgetEmbedResources } from "../../../src/plugins/embeds/resource-cache";
import type {
  RenderPass,
  RenderService,
} from "../../../src/plugins/render/api";
import type { Resource, Resources } from "../../../src/plugins/resources/api";
import {
  FakeImage,
  FakeNode,
  elementsOf,
  everyElement,
  installFakeDom,
  textOf,
} from "./html-fake-dom";

type Call = [string, boolean, boolean];

function mount(overrides: Partial<MountHtmlCardOptions> = {}): {
  node: FakeNode;
  calls: Call[];
} {
  const node = new FakeNode("span");
  const calls: Call[] = [];
  mountHtmlCard({
    node: node as unknown as HTMLElement,
    target: "a.html",
    trusted: true,
    wiki: true,
    signal: new AbortController().signal,
    open: (target, wiki) => calls.push([target, wiki, false]),
    openAsText: (target, wiki) => calls.push([target, wiki, true]),
    ...overrides,
  });
  return { node, calls };
}

/** Nothing in a card runs a page: no frame, script, object or address to load. */
function assertInert(node: FakeNode): void {
  for (const tag of ["iframe", "script", "object", "embed", "webview"]) {
    assert.equal(elementsOf(node, tag).length, 0, tag);
  }
  for (const item of everyElement(node)) {
    assert.equal(item.hasAttribute("src"), false, `${item.tagName} has a src`);
    assert.equal(item.hasAttribute("srcdoc"), false);
  }
}

test("an HTML file in a note is a card with its name and two buttons, and no page", () => {
  const restore = installFakeDom();
  try {
    const { node } = mount({ target: "dir/my%20page.html#height=480" });
    assertInert(node);
    const card = node.children[0]!;
    assert.equal(card.className, "html-embed");
    assert.equal(textOf(card).includes("my page.html"), true);
    const buttons = elementsOf(node, "button");
    assert.deepEqual(
      buttons.map((button) => button.textContent),
      ["Open", "Open as Text"],
    );
    assert.deepEqual(
      buttons.map((button) => button.getAttribute("aria-label")),
      ["Open my page.html", "Open my page.html as text"],
    );
    // In a trusted workspace the card says nothing more.
    assert.equal(textOf(card).includes(HTML_EMBED_DISABLED_NOTE), false);
  } finally {
    restore();
  }
});

test("Open and Open as Text hand the file, without its subpath, to link navigation", () => {
  const restore = installFakeDom();
  try {
    const { node, calls } = mount({ target: "dir/a.html#height=480" });
    const [open, openAsText] = elementsOf(node, "button");
    const event = open!.click();
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.propagationStopped, true);
    openAsText!.click();
    assert.deepEqual(calls, [
      ["dir/a.html", true, false],
      ["dir/a.html", true, true],
    ]);
  } finally {
    restore();
  }
});

test("in Restricted Mode the card is the same, and says why Open shows the file as text", () => {
  const restore = installFakeDom();
  try {
    const { node, calls } = mount({ trusted: false });
    assertInert(node);
    assert.equal(
      HTML_EMBED_DISABLED_NOTE,
      "Interactive HTML is disabled in Restricted Mode",
    );
    assert.ok(textOf(node).includes(HTML_EMBED_DISABLED_NOTE));
    assert.ok(node.children[0]!.classList.contains("html-embed-restricted"));
    elementsOf(node, "button")[0]!.click();
    assert.deepEqual(calls, [["a.html", true, false]]);
  } finally {
    restore();
  }
});

test("the card's buttons stop working with the embed", () => {
  const restore = installFakeDom();
  try {
    const stop = new AbortController();
    const { node, calls } = mount({ signal: stop.signal });
    stop.abort();
    for (const button of elementsOf(node, "button")) {
      button.click();
    }
    assert.deepEqual(calls, []);
  } finally {
    restore();
  }
});

test("the file's name is decoded, and a bad escape is left as written", () => {
  assert.equal(htmlFilename("dir/my%20page.html#height=300"), "my page.html");
  assert.equal(htmlFilename("100%.html"), "100%.html");
  assert.equal(htmlOpenTarget("a/b.html#height=480"), "a/b.html");
  assert.equal(htmlOpenTarget("b.html#gamma&mode=extract"), "b.html");
  assert.equal(htmlOpenTarget("b.html|x200"), "b.html");
});

/** The pass over `nodes`, as much of it as embeds use. */
function passOf(nodes: FakeNode[]): RenderPass {
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

function htmlResources(): Resources {
  return {
    async load(): Promise<Resource> {
      const source = "file:///vault/diagrams/a.html";
      return {
        kind: "html",
        source,
        url: "https://file%2B.vscode-resource.vscode-cdn.net/a.html",
      };
    },
  };
}

test("an embed pass shows an HTML file as a card in every kind of workspace, and wires both buttons", async () => {
  const restore = installFakeDom();
  try {
    for (const render of [{ trusted: true }, { trusted: false }, {}]) {
      forgetEmbedResources(htmlResources());
      const wiki = new FakeNode("span");
      wiki.dataset = { resource: "a.html#height=300", wiki: "true" };
      const opened: unknown[][] = [];
      const embeds = enhanceEmbeds({
        pass: passOf([wiki]),
        render: render as unknown as RenderService,
        resources: htmlResources(),
        open: (...args) => opened.push(args),
      });
      await settled();
      assertInert(wiki);
      const [open, openAsText] = elementsOf(wiki, "button");
      open!.click();
      openAsText!.click();
      assert.deepEqual(
        opened,
        [
          ["a.html", true],
          ["a.html", true, true],
        ],
        JSON.stringify(render),
      );
      // Only a trusted workspace goes unannounced; unknown is not trusted.
      assert.equal(
        textOf(wiki).includes(HTML_EMBED_DISABLED_NOTE),
        render.trusted !== true,
        JSON.stringify(render),
      );
      embeds.dispose();
    }
  } finally {
    restore();
  }
});

test("a Markdown image of an HTML file is shown by a block that stands in for the <img>", async () => {
  const restore = installFakeDom();
  try {
    const image = new FakeImage();
    image.dataset = { resource: "/diagrams/a.html" };
    image.setAttribute("width", "600");
    image.setAttribute("height", "220");
    const page = new FakeNode("p");
    page.append(image);
    const embeds = enhanceEmbeds({
      pass: passOf([image]),
      render: { trusted: true } as unknown as RenderService,
      resources: htmlResources(),
      open: () => {},
    });
    await settled();
    // The <img> shows no children, so a `.file-embed` block took its place.
    assert.equal(
      everyElement(page).some((item) => item.tagName === "IMG"),
      false,
    );
    assertInert(page);
    assert.equal(elementsOf(page, "button").length, 2);
    embeds.dispose();
    assert.equal(
      page.children[0],
      image,
      "the image is back when the pass ends",
    );
  } finally {
    restore();
  }
});

test("a missing HTML file says so, as any embed does, and offers no buttons", async () => {
  const restore = installFakeDom();
  try {
    const node = new FakeNode("span");
    node.dataset = { resource: "gone.html", wiki: "true" };
    const embeds = enhanceEmbeds({
      pass: passOf([node]),
      render: { trusted: true } as unknown as RenderService,
      resources: {
        async load() {
          throw new Error("Resource not found");
        },
      },
      open: () => {},
    });
    await settled();
    assert.ok(textOf(node).includes("gone.html"));
    assert.equal(elementsOf(node, "button").length, 0);
    embeds.dispose();
  } finally {
    restore();
  }
});

test("an html-embed block that names a file becomes an embed; one that does not stays code", () => {
  const restore = installFakeDom();
  try {
    const block = (content: string) => {
      const pre = new FakeNode("pre");
      pre.dataset = {
        fence: "html-embed",
        source: encodeURIComponent(content),
      };
      const parent = new FakeNode("div");
      parent.append(pre);
      return { pre, parent };
    };
    const named = block("file: a/b.html\nheight: 600");
    const code = block("height: 600");
    convertHtmlEmbedBlocks({
      querySelectorAll: () => [named.pre, code.pre],
    } as unknown as ParentNode);
    const embed = named.parent.children[0]!;
    assert.notEqual(embed, named.pre);
    assert.equal(embed.className, "file-embed");
    assert.deepEqual(embed.dataset, { wiki: "true", resource: "a/b.html" });
    assert.equal(code.parent.children[0], code.pre);
  } finally {
    restore();
  }
});

test("a file named with a # shows its card, and Open hands over its encoded link", async () => {
  const restore = installFakeDom();
  try {
    const image = new FakeImage();
    image.dataset = { resource: "/notes/C%23%20notes.html" };
    const page = new FakeNode("p");
    page.append(image);
    const opened: unknown[][] = [];
    const embeds = enhanceEmbeds({
      pass: passOf([image]),
      render: { trusted: true } as unknown as RenderService,
      resources: {
        async load(): Promise<Resource> {
          return {
            kind: "html",
            source: "file:///vault/notes/C%23%20notes.html",
            url: "https://file%2B.vscode-resource.vscode-cdn.net/x",
          };
        },
      },
      open: (...args) => opened.push(args),
    });
    await settled();
    assert.ok(textOf(page).includes("C# notes.html"));
    elementsOf(page, "button")[0]!.click();
    assert.deepEqual(opened, [["/notes/C%23%20notes.html", false]]);
    embeds.dispose();
  } finally {
    restore();
  }
});
