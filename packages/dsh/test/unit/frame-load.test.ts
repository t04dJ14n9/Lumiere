import test from "node:test";
import assert from "node:assert/strict";
import { noteBody } from "../../src/client/index";

interface IframeProps {
  onLoad(event: { currentTarget: HTMLIFrameElement | null }): void;
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
  return {
    createElement: (_type: string, props: Record<string, unknown>) => props,
    useEffect: () => {},
    useRef: <T>(value: T) => ({ current: value }),
    useState: <T>(value: T): [T, (next: T) => void] => [value, () => {}],
  };
}

function frameWith(document: Document) {
  return { contentDocument: document } as unknown as HTMLIFrameElement;
}

test("onLoad ignores the iframe's initial about:blank document", () => {
  const spy = bodyProps();
  const iframe = noteBody(fakeReact(), () => {})(spy.props) as IframeProps;
  iframe.onLoad({
    currentTarget: frameWith({
      URL: "about:blank",
    } as unknown as Document),
  });
  assert.deepEqual(spy.failed, []);
  assert.deepEqual(spy.loaded, []);
});

test("onLoad inspects the iframe that fired, not the live ref", () => {
  const spy = bodyProps();
  const iframe = noteBody(fakeReact(), () => {})(spy.props) as IframeProps;
  const editorDocument = {
    URL: "http://dsh/note",
    querySelector: (selector: string) =>
      selector === 'meta[name="lumiere-panel"]' ? {} : null,
  } as unknown as Document;
  const otherDocument = {
    URL: "http://dsh/note",
    querySelector: () => null,
  } as unknown as Document;
  iframe.ref(frameWith(editorDocument));
  iframe.onLoad({ currentTarget: frameWith(otherDocument) });
  assert.deepEqual(spy.failed, ["failed"]);
});
