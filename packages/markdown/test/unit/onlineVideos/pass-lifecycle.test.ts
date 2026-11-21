import assert from "node:assert/strict";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import {
  tweetFrame,
  trackTweetHeights,
} from "../../../src/plugins/onlineVideos/frame";
import { parseTweet } from "../../../src/plugins/onlineVideos/parse";
import { embedView } from "../../../src/plugins/onlineVideos/tweet-embed";
import { onlineVideosWebview } from "../../../src/plugins/onlineVideos/webview";

/**
 * A DOM small enough to hold what the plugin makes: elements with children,
 * attributes and a parent, a document that makes them, and a window whose
 * `message` listeners go when their signal aborts, as the browser's do.
 */
class FakeElement {
  parent: FakeElement | undefined;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  className = "";
  alt = "";
  src: string | undefined;
  contentWindow: unknown = null;
  constructor(readonly tag: string) {}
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceWith(node: FakeElement): void {
    const at = this.parent?.children.indexOf(this) ?? -1;
    if (!this.parent || at < 0) {
      return;
    }
    this.parent.children[at] = node;
    node.parent = this.parent;
    this.parent = undefined;
  }
  addEventListener(): void {}
  querySelectorAll(): FakeElement[] {
    return this.children.filter((child) => child.tag === "img");
  }
}

interface Listener {
  type: string;
  listener: unknown;
}
const listeners: Listener[] = [];
const fakeWindow = {
  addEventListener(
    type: string,
    listener: unknown,
    options?: { signal?: AbortSignal },
  ): void {
    const entry = { type, listener };
    listeners.push(entry);
    options?.signal?.addEventListener("abort", () => {
      listeners.splice(listeners.indexOf(entry), 1);
    });
  },
};
const fakeDocument = {
  createElement: (tag: string) => new FakeElement(tag),
  body: { classList: { contains: () => false } },
};

const globals = globalThis as unknown as Record<string, unknown>;
beforeEach(() => {
  globals.document = fakeDocument;
  globals.window = fakeWindow;
  mock.timers.enable({ apis: ["setTimeout"] });
});
afterEach(() => {
  mock.timers.reset();
  listeners.length = 0;
});
after(() => {
  delete globals.document;
  delete globals.window;
});

const TWEET = "https://x.com/jack/status/20";

/** The plugin applied to a stand-in context, which keeps what it registers. */
function startPlugin(options: { isTrusted?: boolean } = {}) {
  const stops: (() => void)[] = [];
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const ctx = {
    render: { trusted: options.isTrusted ?? true },
    rpc: { call: async () => true },
    logger: { warn() {} },
    effect(register: () => void | (() => void)) {
      const stop = register();
      if (typeof stop === "function") {
        stops.push(stop);
      }
    },
    on(event: string, handler: (...args: never[]) => unknown) {
      handlers.set(event, handler);
    },
  };
  void onlineVideosWebview.apply(ctx as never, undefined as never);
  return {
    postProcess: handlers.get("render/postProcess") as (pass: unknown) => void,
    claimedHeight: handlers.get("render/claimedHeight") as (
      target: string,
    ) => number | undefined,
    stop: () => stops.forEach((stop) => stop()),
  };
}

/** A render pass holding one image of a tweet link. */
function openPass() {
  const container = new FakeElement("div");
  const image = new FakeElement("img");
  image.dataset.resource = TWEET;
  container.append(image);
  const disposers: (() => void)[] = [];
  const pass = {
    container,
    measure() {},
    onDispose: (dispose: () => void) => disposers.push(dispose),
  };
  return {
    container,
    image,
    pass,
    endPass: () => disposers.forEach((d) => d()),
  };
}

function frameOf(container: FakeElement): FakeElement {
  const shell = container.children[0]!;
  assert.match(shell.className, /mw-embed-tweet/);
  return shell.children[0]!;
}

test("a pass swaps the image for a frame that loads after the settle delay", () => {
  const plugin = startPlugin();
  const { container, image, pass, endPass } = openPass();
  plugin.postProcess(pass);
  const frame = frameOf(container);
  assert.equal(frame.src, undefined);
  assert.equal(listeners.length, 1);
  mock.timers.tick(100);
  assert.equal(
    frame.src,
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=20",
  );
  // The pass ending puts everything back.
  endPass();
  assert.deepEqual(container.children, [image]);
  assert.equal(listeners.length, 0);
});

test("stopping the plugin while a pass is open removes its listener, clears its timer and restores the image", () => {
  const plugin = startPlugin();
  const { container, image, pass, endPass } = openPass();
  plugin.postProcess(pass);
  const frame = frameOf(container);
  assert.equal(listeners.length, 1);
  plugin.stop();
  assert.deepEqual(container.children, [image]);
  assert.equal(listeners.length, 0);
  mock.timers.tick(1000);
  assert.equal(frame.src, undefined, "the load timer was cleared");
  // The pass ending later finds nothing left to undo.
  endPass();
  assert.deepEqual(container.children, [image]);
});

test("every open pass is undone when the plugin stops, and a pass that ended already is not undone twice", () => {
  const plugin = startPlugin();
  const first = openPass();
  const second = openPass();
  const ended = openPass();
  for (const open of [first, second, ended]) {
    plugin.postProcess(open.pass);
  }
  assert.equal(listeners.length, 3);
  ended.endPass();
  assert.equal(listeners.length, 2);
  plugin.stop();
  assert.equal(listeners.length, 0);
  for (const open of [first, second, ended]) {
    assert.deepEqual(open.container.children, [open.image]);
  }
});

test("an aborted signal starts no load timer and adds no listener", () => {
  const view = embedView(parseTweet(TWEET)!, {
    isTrusted: true,
    theme: "light",
  });
  assert.equal(view.kind, "frame");
  const frameView = view as Extract<typeof view, { kind: "frame" }>;
  const events = new AbortController();
  events.abort();
  const { frame } = tweetFrame(frameView, events.signal);
  const track = trackTweetHeights({ signal: events.signal, measure() {} });
  track(frame as unknown as HTMLIFrameElement);
  assert.equal(listeners.length, 0);
  mock.timers.tick(1000);
  assert.equal((frame as unknown as FakeElement).src, undefined);
  assert.equal(mock.timers.runAll(), undefined);
});

test("a live signal does start the timer and the listener, and aborting ends both", () => {
  const view = embedView(parseTweet(TWEET)!, {
    isTrusted: true,
    theme: "dark",
  });
  const frameView = view as Extract<typeof view, { kind: "frame" }>;
  const events = new AbortController();
  const { frame } = tweetFrame(frameView, events.signal);
  trackTweetHeights({ signal: events.signal, measure() {} })(frame);
  assert.equal(listeners.length, 1);
  events.abort();
  assert.equal(listeners.length, 0);
  mock.timers.tick(1000);
  assert.equal((frame as unknown as FakeElement).src, undefined);
});

test("it claims a tweet link for Embeds in either trust mode: the frame's height, or the card's", () => {
  const trusted = startPlugin();
  const untrusted = startPlugin({ isTrusted: false });
  for (const link of [TWEET, "https://twitter.com/jack/status/20"]) {
    assert.equal(trusted.claimedHeight(link), 400, link);
    assert.equal(untrusted.claimedHeight(link), 112, link);
  }
  for (const target of [
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://example.com/page",
    "https://x.com/jack",
    "photo.png",
    "",
  ]) {
    assert.equal(trusted.claimedHeight(target), undefined, target);
    assert.equal(untrusted.claimedHeight(target), undefined, target);
  }
});
