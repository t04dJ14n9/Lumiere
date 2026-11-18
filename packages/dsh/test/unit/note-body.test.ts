import test from "node:test";
import assert from "node:assert/strict";
import { editorFailed, noteBody } from "../../src/client/index";

interface IframeProps {
  key: string;
  src: string;
  title: string;
  ref(element: unknown): void;
}

function bodyProps(revision = 0) {
  return {
    resourceAddress: "dsh-resource://file/session/s/packages/dsh/README.md",
    sessionId: "s",
    content: {
      kind: "renderer",
      revision,
      loaded: () => {},
      failed: () => {},
    },
    useResource: () => ({
      value: {
        absolutePath: "/Users/t04dj14n9/Code/Lumia/packages/dsh/README.md",
        version: "1",
      },
    }),
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

function frameWithText(text: string | undefined) {
  return {
    contentDocument:
      text === undefined
        ? null
        : { getElementById: () => ({ textContent: text }) },
  } as unknown as Parameters<typeof editorFailed>[0];
}

test("the preview iframe points at the note and keeps DSH's revision out of its key", () => {
  const body = noteBody(fakeReact(), () => {});
  const first = body(bodyProps(0)) as IframeProps;
  assert.match(first.src, /^\/lumiere\/editor\?path=/);
  assert.match(first.src, /root=%2FUsers%2Ft04dj14n9%2FCode%2FLumia/);
  assert.equal(first.title, "Lumière");
  assert.ok(first.key.endsWith("#0"));
  // A file change increments revision; remounting would discard unsaved text.
  const later = body(bodyProps(3)) as IframeProps;
  assert.equal(later.src, first.src);
  assert.ok(later.key.endsWith("#0"));
});

test("editorFailed sees the webview's bootstrap error, not a rendered editor", () => {
  assert.equal(editorFailed(null), false);
  assert.equal(editorFailed(frameWithText(undefined)), false);
  assert.equal(editorFailed(frameWithText("# Lumière")), false);
  assert.equal(
    editorFailed(
      frameWithText(
        "Lumiere could not open: Timeout: no reply to ready within 10000 ms",
      ),
    ),
    true,
  );
});

test("a failed ready handshake recreates the iframe once", () => {
  const previousSet = globalThis.setTimeout;
  const previousClear = globalThis.clearTimeout;
  const scheduled: number[] = [];
  const retries: number[] = [];
  const effects: Array<() => void | (() => void)> = [];
  const react = {
    createElement: (_type: string, props: Record<string, unknown>) => props,
    useRef: <T>(value: T) => ({ current: value }),
    useState: <T>(value: T): [T, (next: T) => void] => [
      value,
      (next: T) => {
        retries.push(next as number);
      },
    ],
    useEffect: (effect: () => void | (() => void)) => {
      effects.push(effect);
    },
  };
  globalThis.setTimeout = ((callback: () => void, ms: number) => {
    scheduled.push(ms);
    callback();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;
  try {
    const body = noteBody(react, () => {});
    const iframe = body(bodyProps(0)) as IframeProps;
    iframe.ref(
      frameWithText("Lumiere could not open: Timeout: no reply to ready"),
    );
    runEffects(effects);
    assert.deepEqual(scheduled, [11_000]);
    assert.deepEqual(retries, [1]);
  } finally {
    globalThis.setTimeout = previousSet;
    globalThis.clearTimeout = previousClear;
  }
});

function spyProps() {
  const failed: string[] = [];
  const loaded: string[] = [];
  return {
    props: {
      ...bodyProps(0),
      content: {
        kind: "renderer",
        revision: 0,
        loaded: (version: string) => loaded.push(version),
        failed: () => failed.push("failed"),
      },
    },
    failed,
    loaded,
  };
}

function frameDoc(editor: boolean) {
  return {
    URL: "http://dsh/note",
    querySelector: (selector: string) =>
      editor && selector === 'meta[name="lumiere-panel"]' ? {} : null,
  } as unknown as Document;
}

test("onLoad ignores the iframe's initial about:blank document", () => {
  const spy = spyProps();
  const body = noteBody(fakeReact(), () => {});
  const iframe = body(spy.props) as IframeProps & {
    onLoad(event: { currentTarget: HTMLIFrameElement | null }): void;
  };
  iframe.onLoad({
    currentTarget: {
      contentDocument: { URL: "about:blank" } as unknown as Document,
    } as unknown as HTMLIFrameElement,
  });
  assert.deepEqual(spy.failed, []);
  assert.deepEqual(spy.loaded, []);
});

test("onLoad inspects the iframe that fired, not the live ref", () => {
  const spy = spyProps();
  const body = noteBody(fakeReact(), () => {});
  const iframe = body(spy.props) as IframeProps & {
    onLoad(event: { currentTarget: HTMLIFrameElement | null }): void;
  };
  // The ref still points at a healthy editor page, but a late load arrives
  // from an iframe whose document is not the editor page.
  iframe.ref({
    contentDocument: frameDoc(true),
  } as unknown as HTMLIFrameElement);
  iframe.onLoad({
    currentTarget: {
      contentDocument: frameDoc(false),
    } as unknown as HTMLIFrameElement,
  });
  assert.deepEqual(spy.failed, ["failed"]);
});

test("DSH's Reload control recreates an iframe stuck on the failure", () => {
  const retries: number[] = [];
  const effects: Array<() => void | (() => void)> = [];
  const refs: Array<{ current: unknown }> = [];
  let refIndex = 0;
  const react = {
    createElement: (_type: string, props: Record<string, unknown>) => props,
    useRef<T>(value: T): { current: T } {
      const stored = refs[refIndex] ?? { current: value };
      refs[refIndex] = stored;
      refIndex += 1;
      return stored as { current: T };
    },
    useState<T>(value: T): [T, (next: T) => void] {
      return [
        value,
        (next: T) => {
          retries.push(next as number);
        },
      ];
    },
    useEffect(effect: () => void | (() => void)) {
      effects.push(effect);
    },
  };
  const body = noteBody(react, () => {});
  const first = body(bodyProps(0)) as IframeProps;
  first.ref(frameWithText("Lumiere could not open: Timeout"));
  effects.length = 0;
  refIndex = 0;
  const second = body(bodyProps(3)) as IframeProps;
  assert.ok(
    second.key.endsWith("#0"),
    "a revision alone must not discard text",
  );
  // Hold the ready timer so only the revision watcher can retry.
  const previousSet = globalThis.setTimeout;
  globalThis.setTimeout = (() => 0) as unknown as typeof setTimeout;
  try {
    runEffects(effects);
  } finally {
    globalThis.setTimeout = previousSet;
  }
  assert.deepEqual(retries, [1]);
});

/**
 * Runs every effect a render registered, in order, without depending on how
 * many there are. Effects that need browser APIs (window listeners, DSH's
 * theme events) throw under Node; they play no part in these assertions.
 */
function runEffects(effects: Array<() => void | (() => void)>): void {
  for (const effect of effects) {
    try {
      effect();
    } catch {
      // A browser-only effect; see above.
    }
  }
}
