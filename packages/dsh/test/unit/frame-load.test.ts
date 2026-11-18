import test from "node:test";
import assert from "node:assert/strict";
import { editorFailed, noteBody, pdfBody } from "../../src/client/index";

interface FrameEvent {
  readonly currentTarget: HTMLIFrameElement | null;
}

interface IframeProps {
  onLoad(event: FrameEvent): void;
  onError(event: FrameEvent): void;
  ref(element: HTMLIFrameElement | null): void;
}

interface PdfIframeProps extends IframeProps {
  readonly key: string;
  onError(): void;
}

function bodyProps() {
  const failed: string[] = [];
  const loaded: string[] = [];
  return {
    props: {
      resourceAddress: "dsh-resource://file/session/s/packages/dsh/README.md",
      sessionId: "s",
      content: {
        kind: "renderer",
        revision: 0,
        loaded: (version: string) => loaded.push(version),
        failed: () => failed.push("failed"),
      },
      useResource: () => ({
        value: {
          absolutePath: "/Users/t04dj14n9/Code/Lumiere/packages/dsh/README.md",
          version: "1",
        },
      }),
    },
    failed,
    loaded,
  };
}

function pdfBodyProps(revision = 0) {
  const failed: string[] = [];
  const loaded: string[] = [];
  const scrollports: (HTMLElement | null)[] = [];
  return {
    props: {
      resourceAddress: "dsh-resource://file/session/s/papers/A.pdf",
      sessionId: "s",
      content: {
        kind: "renderer",
        revision,
        loaded: (version: string) => loaded.push(version),
        failed: () => failed.push("failed"),
      },
      scrollportRef: (element: HTMLElement | null) => scrollports.push(element),
      useResource: () => ({
        value: {
          absolutePath: "/Users/t04dj14n9/Code/Lumiere/papers/A.pdf",
          version: "1",
        },
      }),
    },
    failed,
    loaded,
    scrollports,
  };
}

function fakeReact() {
  const effects: Array<() => void | (() => void)> = [];
  return {
    createElement: (_type: string, props?: Record<string, unknown> | null) =>
      props ?? {},
    useEffect: (
      effect: () => void | (() => void),
      _dependencies?: unknown[],
    ) => {
      effects.push(effect);
    },
    useRef: <T>(value: T) => ({ current: value }),
    useState: <T>(value: T): [T, (next: T) => void] => [value, () => {}],
    effects,
  };
}

/** Re-run noteBody's last effect, as a DSH revision bump would. */
function signalRevision(react: ReturnType<typeof fakeReact>): void {
  react.effects.at(-1)?.();
}

function frameDocument(url: string, editor = false): Document {
  return {
    URL: url,
    querySelector: (selector: string) =>
      editor && selector === 'meta[name="lumiere-panel"]' ? {} : null,
    getElementById: () => null,
  } as unknown as Document;
}

function frameWith(nextDocument: Document): HTMLIFrameElement {
  return { contentDocument: nextDocument } as unknown as HTMLIFrameElement;
}

function setDocument(frame: HTMLIFrameElement, nextDocument: Document): void {
  (frame as unknown as { contentDocument: Document }).contentDocument =
    nextDocument;
}

function pdfFrame(
  document: Document,
  post: (message: unknown) => void,
): HTMLIFrameElement {
  return {
    contentDocument: document,
    contentWindow: { postMessage: post },
  } as unknown as HTMLIFrameElement;
}

/** The few DOM values sendTheme reads, and the postMessage origin it uses. */
function withDshDom(run: () => void): void {
  const previousDocument = globalThis.document;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  const previousLocation = Object.getOwnPropertyDescriptor(
    globalThis,
    "location",
  );
  globalThis.document = {
    body: { hasAttribute: () => false },
    documentElement: { hasAttribute: () => false },
  } as unknown as Document;
  globalThis.getComputedStyle = (() => ({
    fontFamily: "system-ui, sans-serif",
    getPropertyValue: () => "",
  })) as unknown as typeof getComputedStyle;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    writable: true,
    value: { origin: "http://dsh" },
  });
  try {
    run();
  } finally {
    globalThis.document = previousDocument;
    globalThis.getComputedStyle = previousGetComputedStyle;
    if (previousLocation) {
      Object.defineProperty(globalThis, "location", previousLocation);
    } else {
      Reflect.deleteProperty(globalThis, "location");
    }
  }
}

test("onLoad ignores the iframe's initial about:blank document", () => {
  const spy = bodyProps();
  const react = fakeReact();
  const iframe = noteBody(react, () => {})(spy.props) as IframeProps;
  const frame = frameWith(frameDocument("about:blank"));
  iframe.ref(frame);
  iframe.onLoad({ currentTarget: frame });
  iframe.onLoad({ currentTarget: frame });
  assert.deepEqual(spy.failed, []);
  assert.deepEqual(spy.loaded, []);
  signalRevision(react);
  assert.deepEqual(spy.loaded, []);
});

test("onLoad reports a real about:blank document that loads first", () => {
  const spy = bodyProps();
  const iframe = noteBody(fakeReact(), () => {})(spy.props) as IframeProps;
  const frame = frameWith(frameDocument("about:blank"));
  iframe.ref(frame);
  setDocument(frame, frameDocument("about:blank"));
  iframe.onLoad({ currentTarget: frame });
  assert.deepEqual(spy.failed, ["failed"]);
  assert.deepEqual(spy.loaded, []);
});

test("onLoad reports a rendered editor page and re-announces it when DSH bumps the revision", () => {
  const spy = bodyProps();
  const react = fakeReact();
  const iframe = noteBody(react, () => {})(spy.props) as IframeProps;
  const frame = frameWith(frameDocument("http://dsh/note", true));
  iframe.ref(frame);
  iframe.onLoad({ currentTarget: frame });
  assert.deepEqual(spy.failed, []);
  assert.deepEqual(spy.loaded, ["1"]);
  spy.props.content.revision = 1;
  signalRevision(react);
  assert.deepEqual(spy.loaded, ["1", "1"]);
});

test("a re-render detach and re-attach does not retire the live frame", () => {
  const spy = bodyProps();
  const iframe = noteBody(fakeReact(), () => {})(spy.props) as IframeProps;
  const frame = frameWith(frameDocument("about:blank"));
  iframe.ref(frame);
  // React calls the callback ref with null, then with the same element, when
  // the inline ref's identity changes between renders.
  iframe.ref(null);
  iframe.ref(frame);
  setDocument(frame, frameDocument("http://dsh/note", true));
  iframe.onLoad({ currentTarget: frame });
  assert.deepEqual(spy.failed, []);
  assert.deepEqual(spy.loaded, ["1"]);
});

test("the mount effect keeps the initial blank document the ref captured", () => {
  const spy = bodyProps();
  const react = fakeReact();
  const iframe = noteBody(react, () => {})(spy.props) as IframeProps;
  const blank = frameDocument("about:blank");
  const frame = frameWith(blank);
  iframe.ref(frame);
  // Effects run after the ref attaches in a real render.
  react.effects[0]?.();
  iframe.onLoad({ currentTarget: frame });
  assert.deepEqual(spy.failed, []);
  assert.deepEqual(spy.loaded, []);
});

test("onLoad reports a later about:blank load from the same frame", () => {
  const spy = bodyProps();
  const react = fakeReact();
  const iframe = noteBody(react, () => {})(spy.props) as IframeProps;
  const frame = frameWith(frameDocument("about:blank"));
  iframe.ref(frame);
  iframe.onLoad({ currentTarget: frame });
  setDocument(frame, frameDocument("about:blank"));
  iframe.onLoad({ currentTarget: frame });
  assert.deepEqual(spy.failed, ["failed"]);
  assert.deepEqual(spy.loaded, []);
  signalRevision(react);
  assert.deepEqual(spy.loaded, []);
  setDocument(frame, frameDocument("http://dsh/note", true));
  iframe.onLoad({ currentTarget: frame });
  assert.deepEqual(spy.loaded, ["1"]);
});

test("onLoad reports a reload to about:blank after a rendered editor page", () => {
  const spy = bodyProps();
  const react = fakeReact();
  const iframe = noteBody(react, () => {})(spy.props) as IframeProps;
  const frame = frameWith(frameDocument("about:blank"));
  iframe.ref(frame);
  iframe.onLoad({ currentTarget: frame });
  setDocument(frame, frameDocument("http://dsh/note", true));
  iframe.onLoad({ currentTarget: frame });
  setDocument(frame, frameDocument("about:blank"));
  iframe.onLoad({ currentTarget: frame });
  assert.deepEqual(spy.failed, ["failed"]);
  assert.deepEqual(spy.loaded, ["1"]);
  signalRevision(react);
  assert.deepEqual(spy.loaded, ["1"]);
});

test("onLoad inspects the live iframe's document", () => {
  const spy = bodyProps();
  const iframe = noteBody(fakeReact(), () => {})(spy.props) as IframeProps;
  const frame = frameWith(frameDocument("http://dsh/note"));
  iframe.ref(frame);
  iframe.onLoad({ currentTarget: frame });
  assert.deepEqual(spy.failed, ["failed"]);
  assert.deepEqual(spy.loaded, []);
});

test("onLoad and onError from an iframe DSH replaced are ignored", () => {
  const spy = bodyProps();
  const react = fakeReact();
  const iframe = noteBody(react, () => {})(spy.props) as IframeProps;
  const stale = frameWith(frameDocument("http://dsh/note"));
  iframe.ref(stale);
  // A new attempt (key change) attaches a different element.
  const live = frameWith(frameDocument("http://dsh/note", true));
  iframe.ref(live);

  iframe.onLoad({ currentTarget: stale });
  iframe.onError({ currentTarget: stale });
  setDocument(stale, frameDocument("http://dsh/note", true));
  iframe.onLoad({ currentTarget: stale });
  signalRevision(react);
  assert.deepEqual(spy.failed, []);
  assert.deepEqual(spy.loaded, []);

  iframe.onLoad({ currentTarget: live });
  assert.deepEqual(spy.loaded, ["1"]);
});

test("onError reports a failure and stops re-announcing a loaded page", () => {
  const spy = bodyProps();
  const react = fakeReact();
  const iframe = noteBody(react, () => {})(spy.props) as IframeProps;
  const frame = frameWith(frameDocument("http://dsh/note", true));
  iframe.ref(frame);
  iframe.onLoad({ currentTarget: frame });
  iframe.onError({ currentTarget: frame });
  assert.deepEqual(spy.failed, ["failed"]);
  assert.deepEqual(spy.loaded, ["1"]);
  signalRevision(react);
  assert.deepEqual(spy.loaded, ["1"]);
});

test("editorFailed recognizes the webview's bootstrap error", () => {
  const frame = (text: string) =>
    ({
      contentDocument: {
        getElementById: (id: string) =>
          id === "app" ? { textContent: text } : null,
      },
    }) as unknown as HTMLIFrameElement;
  assert.equal(
    editorFailed(frame("Lumiere could not open: no host")),
    true,
    "the prefix written by packages/markdown/src/webview/main.ts",
  );
  assert.equal(editorFailed(frame("Lumia could not open: no host")), false);
  assert.equal(editorFailed(null), false);
});

test("PDF body reports only a Lumière page as loaded and sends DSH's theme", () => {
  withDshDom(() => {
    const spy = pdfBodyProps();
    const iframe = pdfBody(fakeReact())(spy.props) as PdfIframeProps;
    const posted: unknown[] = [];
    const errorDocument = {
      URL: "http://dsh/error",
      querySelector: () => null,
    } as unknown as Document;
    const pageDocument = {
      URL: "http://dsh/pdf",
      querySelector: (selector: string) =>
        selector === 'meta[name="lumiere-panel"]' ? {} : null,
    } as unknown as Document;
    const page = pdfFrame(pageDocument, (message) => posted.push(message));
    iframe.ref(page);
    iframe.onLoad({
      currentTarget: frameWith({
        URL: "about:blank",
      } as unknown as Document),
    });
    iframe.onLoad({ currentTarget: pdfFrame(errorDocument, () => {}) });
    assert.deepEqual(spy.failed, ["failed"], "an HTTP error is not loaded");
    assert.deepEqual(spy.loaded, []);

    iframe.onLoad({ currentTarget: page });
    assert.deepEqual(spy.failed, ["failed"]);
    assert.deepEqual(spy.loaded, ["1"]);
    assert.deepEqual(spy.scrollports, [page]);
    assert.equal(posted.length, 1);
    assert.equal((posted[0] as { lumiere?: string }).lumiere, "theme");
  });
});

test("PDF body recreates its iframe when DSH reloads the content", () => {
  const first = pdfBody(fakeReact())(pdfBodyProps(0).props) as PdfIframeProps;
  const second = pdfBody(fakeReact())(pdfBodyProps(1).props) as PdfIframeProps;
  assert.notEqual(first.key, second.key);
});
