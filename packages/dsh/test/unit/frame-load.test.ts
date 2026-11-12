import test from "node:test";
import assert from "node:assert/strict";
import { noteBody } from "../../src/client/index";

interface FrameEvent {
  readonly currentTarget: HTMLIFrameElement | null;
}

interface IframeProps {
  onLoad(event: FrameEvent): void;
  onError(event: FrameEvent): void;
  ref(element: HTMLIFrameElement | null): void;
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
          absolutePath: "/Users/t04dj14n9/Code/Lumia/packages/dsh/README.md",
          version: "1",
        },
      }),
    },
    failed,
    loaded,
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
  } as unknown as Document;
}

function frameWith(nextDocument: Document): HTMLIFrameElement {
  return { contentDocument: nextDocument } as unknown as HTMLIFrameElement;
}

function setDocument(frame: HTMLIFrameElement, nextDocument: Document): void {
  (frame as unknown as { contentDocument: Document }).contentDocument =
    nextDocument;
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
  const old = bodyProps();
  const oldReact = fakeReact();
  const oldIframe = noteBody(oldReact, () => {})(old.props) as IframeProps;
  const stale = frameWith(frameDocument("http://dsh/note"));
  oldIframe.ref(stale);
  oldIframe.ref(null);

  const next = bodyProps();
  const nextReact = fakeReact();
  const nextIframe = noteBody(nextReact, () => {})(next.props) as IframeProps;
  const live = frameWith(frameDocument("http://dsh/note", true));
  nextIframe.ref(live);

  oldIframe.onLoad({ currentTarget: stale });
  oldIframe.onError({ currentTarget: stale });
  setDocument(stale, frameDocument("http://dsh/note", true));
  oldIframe.onLoad({ currentTarget: stale });
  signalRevision(oldReact);
  signalRevision(nextReact);
  assert.deepEqual(old.failed, []);
  assert.deepEqual(old.loaded, []);
  assert.deepEqual(next.failed, []);
  assert.deepEqual(next.loaded, []);

  nextIframe.onLoad({ currentTarget: live });
  assert.deepEqual(next.loaded, ["1"]);
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
