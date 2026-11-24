import test from "node:test";
import assert from "node:assert/strict";
import { fromHost, webviewTransport } from "../../../src/webview/transport";

const origin = "vscode-webview://test-origin";

/** The editor page, with `frames` as the `iframe` elements a note put in it. */
function pageWith(frames: { contentWindow: unknown }[] = []) {
  const page = Object.assign(new EventTarget(), {
    location: { origin },
    parent: undefined as unknown,
    document: { querySelectorAll: () => frames },
  });
  page.parent = page;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: page,
  });
  return page;
}

const message = (source: unknown, from: string) =>
  ({ source, origin: from }) as MessageEvent<unknown>;

/** A real event, as the page's listener gets it: `source` has only a getter. */
function postedEvent(data: string, source: unknown, from: string) {
  const event = new MessageEvent("message", { data, origin: from });
  Object.defineProperty(event, "source", { value: source });
  return event;
}

test("webview accepts its real wrapper after VS Code masks window.parent", () => {
  pageWith();
  try {
    const wrapper = {};
    assert.equal(fromHost(message(wrapper, origin)), true);
    assert.equal(fromHost(message({}, "https://embedded.example")), false);
    assert.equal(fromHost(message({}, "null")), false);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("a message with no source is not the host's: a removed frame's post, or an opaque origin", () => {
  pageWith();
  try {
    // A frame that posts and is removed at once arrives without a source,
    // but still carries its own origin.
    assert.equal(fromHost(message(null, "https://remote.example")), false);
    assert.equal(fromHost(message(null, "null")), false);
    // The host's wrapper is always there to be named as the source.
    assert.equal(fromHost(message(null, origin)), false);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("a window of an iframe in the page is not the host, whatever origin it reports", () => {
  const frame = {};
  const page = pageWith([{ contentWindow: frame }]);
  try {
    // An `about:blank` or `srcdoc` frame inherits the page's origin.
    assert.equal(fromHost(message(frame, origin)), false);
    assert.equal(fromHost(message(page, origin)), true);
    assert.equal(fromHost(message({}, origin)), true);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("the transport delivers the host's message and drops the frames'", () => {
  const frame = {};
  const page = pageWith([{ contentWindow: frame }]);
  try {
    const received: unknown[] = [];
    const stop = webviewTransport({ postMessage() {} }).listen((data) =>
      received.push(data),
    );
    const post = (data: string, source: unknown, from: string) =>
      page.dispatchEvent(postedEvent(data, source, from));
    post("removed frame", null, "https://remote.example");
    post("opaque", {}, "null");
    post("page frame", frame, origin);
    post("host", {}, origin);
    stop();
    assert.deepEqual(received, ["host"]);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});
