import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { sanitizeGraphics } from "./graphics";

const svgNamespace = "http://www.w3.org/2000/svg";
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const label = `<svg xmlns="${svgNamespace}"><foreignObject width="100" height="50"><div xmlns="${htmlNamespace}"><span>Visible 中文</span><br/>second line</div></foreignObject></svg>`;

// jsdom defaults deliberately disable scripts and subresource loading.
function withDocument(run: (document: Document) => void): void {
  const dom = new JSDOM("");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });
  try {
    run(dom.window.document as unknown as Document);
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, "window", previous);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
    dom.window.close();
  }
}

function reparse(document: Document, html: string): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

test("trusted graphics preserve foreignObject XHTML label text and namespaces", () => {
  withDocument((document) => {
    const clean = reparse(
      document,
      sanitizeGraphics(label, { allowForeignObject: true }),
    );
    assert.equal(clean.querySelector("svg")?.namespaceURI, svgNamespace);
    assert.equal(
      clean.querySelector("foreignObject")?.namespaceURI,
      svgNamespace,
    );
    assert.equal(
      clean.querySelector("foreignObject div")?.namespaceURI,
      htmlNamespace,
    );
    assert.equal(clean.querySelector("span")?.textContent, "Visible 中文");
    assert.equal(clean.querySelector("br")?.namespaceURI, htmlNamespace);
    assert.match(clean.textContent ?? "", /second line/);
  });
});

function assertNoActiveContent(container: HTMLElement): void {
  assert.equal(
    container.querySelector("script,iframe,object,embed,form"),
    null,
  );
  for (const element of container.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      assert.doesNotMatch(attribute.name, /^on/i);
      if (["href", "xlink:href", "src"].includes(attribute.name)) {
        const protocol = Array.from(attribute.value)
          .filter(
            (character) =>
              character.charCodeAt(0) > 0x20 &&
              character.charCodeAt(0) !== 0x7f,
          )
          .join("");
        assert.doesNotMatch(
          protocol,
          /^(javascript:|vbscript:|data:text\/html)/i,
        );
      }
    }
  }
}

function foreignObject(contents: string): string {
  return `<svg xmlns="${svgNamespace}"><foreignObject><div xmlns="${htmlNamespace}">${contents}</div></foreignObject></svg>`;
}

test("trusted labels strip forbidden tags, event handlers and unsafe URLs after reparsing", () => {
  withDocument((document) => {
    const dirty = foreignObject(
      `<span onclick="alert(1)">Safe label</span><script>alert(1)</script><iframe src="https://example.invalid/"></iframe><object></object><embed/><form><input/></form><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">bad</a>`,
    );
    const clean = reparse(
      document,
      sanitizeGraphics(dirty, { allowForeignObject: true }),
    );
    assert.match(clean.textContent ?? "", /Safe label/);
    assertNoActiveContent(clean);
    assert.equal(clean.querySelector("a")?.hasAttribute("href"), false);
  });
});

test("trusted graphics reject entity and control-obfuscated unsafe protocols", () => {
  withDocument((document) => {
    for (const url of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "java&#x09;script:alert(1)",
      "java&#10;script:alert(1)",
      "&#106;avascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
    ]) {
      const dirty = foreignObject(
        `<a href="${url}">Label</a><svg xmlns="${svgNamespace}"><a xlink:href="${url}" xmlns:xlink="http://www.w3.org/1999/xlink"><text>SVG</text></a></svg>`,
      );
      const clean = reparse(
        document,
        sanitizeGraphics(dirty, { allowForeignObject: true }),
      );
      assertNoActiveContent(clean);
      for (const link of clean.querySelectorAll("a")) {
        assert.equal(link.hasAttribute("href"), false);
        assert.equal(link.hasAttribute("xlink:href"), false);
      }
    }
  });
});

test("nested SVG HTML MathML namespace transitions remain inert after sink reparsing", () => {
  withDocument((document) => {
    const payloads = [
      foreignObject(
        `<svg xmlns="${svgNamespace}"><foreignObject><div xmlns="${htmlNamespace}"><img src="x" onerror="alert(1)"><script>alert(1)</script></div></foreignObject></svg>`,
      ),
      foreignObject(
        `<math xmlns="http://www.w3.org/1998/Math/MathML"><mtext><img src="x" onerror="alert(1)"></mtext></math>`,
      ),
      `<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">`,
      `<svg><p><style><g title="</style><img src=x onerror=alert(1)>">`,
    ];
    for (const dirty of payloads) {
      const once = reparse(
        document,
        sanitizeGraphics(dirty, { allowForeignObject: true }),
      );
      assertNoActiveContent(once);
      assertNoActiveContent(reparse(document, once.innerHTML));
    }
  });
});

test("one cached purifier does not leak trusted foreignObject settings to default calls", () => {
  withDocument((document) => {
    const trusted = () =>
      reparse(document, sanitizeGraphics(label, { allowForeignObject: true }));
    assert.equal(trusted().querySelectorAll("foreignObject").length, 1);
    const untrusted = reparse(document, sanitizeGraphics(label));
    assert.equal(untrusted.querySelector("foreignObject"), null);
    assert.doesNotMatch(untrusted.textContent ?? "", /Visible/);
    assert.equal(trusted().querySelector("span")?.textContent, "Visible 中文");
  });
});

test("default graphics retain MathJax SVG symbols and use references", () => {
  withDocument((document) => {
    const math = `<mjx-container><svg xmlns="${svgNamespace}"><defs><path id="glyph" d="M0 0L1 1"/></defs><use xlink:href="#glyph" xmlns:xlink="http://www.w3.org/1999/xlink"/></svg></mjx-container>`;
    const clean = reparse(document, sanitizeGraphics(math));
    assert.ok(clean.querySelector("mjx-container svg defs path"));
    assert.equal(
      clean.querySelector("use")?.getAttribute("xlink:href"),
      "#glyph",
    );
    assert.equal(clean.querySelector("use")?.namespaceURI, svgNamespace);
  });
});

test("trusted graphics retain compatible inline CSS and ordinary image URLs, not a CSS resource sandbox", () => {
  withDocument((document) => {
    // DOMPurify does not police CSS or fetches. Host CSP controls resource use;
    // jsdom here enables neither script execution nor resource loading.
    const dirty = foreignObject(
      `<style>.label { color: red }</style><span style="color:red">Styled label</span><img src="https://example.invalid/label.png"><img src="data:image/png;base64,AA=="><a href="https://example.invalid/note">Link</a>`,
    );
    const clean = reparse(
      document,
      sanitizeGraphics(dirty, { allowForeignObject: true }),
    );
    assert.match(clean.querySelector("style")?.textContent ?? "", /color: red/);
    assert.equal(
      clean.querySelector("span")?.getAttribute("style"),
      "color:red",
    );
    assert.deepEqual(
      [...clean.querySelectorAll("img")].map((image) =>
        image.getAttribute("src"),
      ),
      ["https://example.invalid/label.png", "data:image/png;base64,AA=="],
    );
    assert.equal(
      clean.querySelector("a")?.getAttribute("href"),
      "https://example.invalid/note",
    );
    assertNoActiveContent(clean);
  });
});
