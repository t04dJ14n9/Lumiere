/**
 * Listener-order regressions for packages/host-node/src/page/shim.ts.
 * Imports the actual shim (and the real fromHost source, transpiled). The
 * DOM/window here is only a harness so that module can load in Node; it is
 * not a second copy of the listener.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SHOWN } from "../../src/embedding";
import type * as TypeScript from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const transportPath = join(here, "../../../markdown/src/webview/transport.ts");

/** Browser MessageEvent allows a window source; Node's built-in does not. */
class PageMessageEvent extends Event {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
  readonly ports: MessagePort[];
  constructor(
    type: string,
    init: {
      data: unknown;
      origin: string;
      source?: unknown;
      ports?: MessagePort[];
    },
  ) {
    super(type);
    this.data = init.data;
    this.origin = init.origin;
    this.source = init.source ?? null;
    this.ports = init.ports ?? [];
  }
}

type FromHost = (event: { source: unknown; origin: string }) => boolean;

function extractExportedFunction(source: string, name: string): string {
  const signature = `export function ${name}`;
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature} in ${transportPath}`);
  const brace = source.indexOf("{", start);
  assert.ok(brace >= 0, `missing body for ${name}`);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unclosed ${name} in ${transportPath}`);
}

function loadTypescript(): typeof TypeScript {
  const roots = [
    join(here, "../../../../"),
    join(process.cwd(), "../"),
    process.cwd(),
  ];
  for (const root of roots) {
    const pkg = join(root, "node_modules/typescript/package.json");
    if (existsSync(pkg)) {
      return createRequire(pkg)("typescript") as typeof TypeScript;
    }
  }
  throw new Error(
    "typescript is not resolvable from the repo root; install workspace devDependencies before running this test",
  );
}

function fromHostFromActualSource(windowRef: {
  location: { origin: string };
}): FromHost {
  const ts = loadTypescript();
  const extracted = extractExportedFunction(
    readFileSync(transportPath, "utf8"),
    "fromHost",
  );
  const js = ts
    .transpileModule(extracted, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      reportDiagnostics: true,
    })
    .outputText.replace(/^\s*export\s+/m, "");
  assert.match(js, /function fromHost\s*\(/);
  return new Function("window", `${js}\nreturn fromHost;`)(
    windowRef,
  ) as FromHost;
}

function installPageGlobals() {
  const origin = "https://app.local";
  const parentPosts: { data: unknown; origin: string }[] = [];
  const style = new Map<string, string>();
  const classes = new Set<string>();
  const dataset: Record<string, string> = {};
  const metas: Record<string, string> = {
    "lumiere-panel": "p1",
    "lumiere-transport": "channel",
  };
  const documentElement = {
    style: {
      setProperty(name: string, value: string) {
        style.set(name, value);
      },
      getPropertyValue(name: string) {
        return style.get(name);
      },
      get colorScheme() {
        return style.get("color-scheme") ?? "";
      },
      set colorScheme(value: string) {
        style.set("color-scheme", value);
      },
    },
  };
  const body = {
    classList: {
      add(...names: string[]) {
        for (const name of names) {
          classes.add(name);
        }
      },
      remove(...names: string[]) {
        for (const name of names) {
          classes.delete(name);
        }
      },
      contains(name: string) {
        return classes.has(name);
      },
    },
    dataset,
  };
  const head = {
    append(_node: { textContent?: string }) {},
  };
  const document = {
    documentElement,
    body,
    head,
    createElement(tag: string) {
      return {
        tagName: tag,
        textContent: "",
        className: "",
        setAttribute() {},
        remove() {},
        value: "",
      };
    },
    querySelector(selector: string) {
      const matched = /^meta\[name="([^"]+)"\]$/.exec(selector);
      const name = matched?.[1];
      if (!name) {
        return null;
      }
      const content = metas[name];
      return content === undefined ? null : { content };
    },
    addEventListener() {},
  };
  const window = new EventTarget() as EventTarget & {
    document: typeof document;
    location: { origin: string; host: string; protocol: string };
    parent: { postMessage: (data: unknown, origin: string) => void };
    matchMedia: (query: string) => {
      matches: boolean;
      addEventListener: () => void;
      removeEventListener: () => void;
    };
    acquireVsCodeApi?: unknown;
  };
  const parent = {
    postMessage(data: unknown, targetOrigin: string) {
      parentPosts.push({ data, origin: targetOrigin });
    },
  };
  Object.assign(window, {
    document,
    location: { origin, host: "app.local", protocol: "https:" },
    parent,
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  Object.assign(globalThis, {
    window,
    document,
    location: window.location,
    matchMedia: window.matchMedia,
    // The shim watches for SVG images (page/svg-images.ts).
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  return { window, style, classes, dataset, parentPosts, origin, parent };
}

const page = installPageGlobals();
const fromHost = fromHostFromActualSource(page.window);
await import("../../src/page/shim");

const portFrames: string[] = [];
const channel = new MessageChannel();
channel.port2.onmessage = (event) => {
  portFrames.push(String(event.data));
};
channel.port1.start();
channel.port2.start();

const foreignFrames: string[] = [];
const foreignPort = new MessageChannel();
foreignPort.port2.onmessage = (event) => {
  foreignFrames.push(String(event.data));
};
foreignPort.port1.start();
foreignPort.port2.start();

/** The embedder's answer to the shim's connect request. */
function connectPort(): boolean {
  return dispatchAndWatch(
    new PageMessageEvent("message", {
      data: { lumiere: "port", panel: "p1" },
      origin: page.origin,
      source: page.parent,
      ports: [channel.port1],
    }),
  );
}

function closePorts() {
  channel.port1.close();
  channel.port2.close();
  foreignPort.port1.close();
  foreignPort.port2.close();
}

function resetTheme() {
  page.classes.clear();
  page.style.clear();
  for (const key of Object.keys(page.dataset)) {
    delete page.dataset[key];
  }
  portFrames.length = 0;
}

function dispatchAndWatch(event: PageMessageEvent) {
  let later = false;
  const onLater = () => {
    later = true;
  };
  page.window.addEventListener("message", onLater);
  page.window.dispatchEvent(event);
  page.window.removeEventListener("message", onLater);
  return later;
}

let foreignPortLater = false;
let trustedPortLater = false;
test.before(() => {
  foreignPortLater = dispatchAndWatch(
    new PageMessageEvent("message", {
      data: { lumiere: "port", panel: "p1" },
      origin: "https://evil.example",
      source: page.parent,
      ports: [foreignPort.port1],
    }),
  );
  trustedPortLater = connectPort();
});

function assertThemeNotApplied() {
  assert.equal(page.classes.has("vscode-dark"), false);
  assert.equal(page.style.get("--vscode-editor-background"), undefined);
}

const trustedTheme = {
  lumiere: "theme",
  dark: true,
  variables: { "--vscode-editor-background": "#151517" },
};

const foreignSource = { foreign: true };

test("an untrusted lumiere message is not stopped, so a later listener still runs", () => {
  resetTheme();
  const later = dispatchAndWatch(
    new PageMessageEvent("message", {
      data: trustedTheme,
      origin: "https://evil.example",
      source: foreignSource,
    }),
  );
  assert.equal(later, true);
  assertThemeNotApplied();
});

test("a same-origin lumiere message from a foreign source is not stopped", () => {
  resetTheme();
  const event = new PageMessageEvent("message", {
    data: trustedTheme,
    origin: page.origin,
    source: foreignSource,
  });
  // fromHost trusts same-origin independently; the shim still requires parent.
  assert.equal(fromHost(event), true);
  const later = dispatchAndWatch(event);
  assert.equal(later, true);
  assertThemeNotApplied();
});

test("a parent lumiere message from a foreign origin is not stopped", () => {
  resetTheme();
  const event = new PageMessageEvent("message", {
    data: trustedTheme,
    origin: "https://evil.example",
    source: page.parent,
  });
  // fromHost rejects a non-window, non-null source at a foreign origin.
  assert.equal(fromHost(event), false);
  const later = dispatchAndWatch(event);
  assert.equal(later, true);
  assertThemeNotApplied();
});

test("a foreign-origin parent port message is neither stopped nor accepted", async () => {
  resetTheme();
  assert.equal(foreignPortLater, true);
  assert.equal(trustedPortLater, false);
  const later = dispatchAndWatch(
    new PageMessageEvent("message", {
      data: SHOWN,
      origin: page.origin,
      source: page.parent,
    }),
  );
  assert.equal(later, false);
  await nextPortFrame();
  assert.deepEqual(
    portFrames.map((text) => JSON.parse(text)),
    [{ ch: "ui", data: { type: "focus" } }],
  );
  assert.deepEqual(foreignFrames, []);
});

test("a trusted parent theme message is applied and stops later listeners", () => {
  resetTheme();
  const later = dispatchAndWatch(
    new PageMessageEvent("message", {
      data: trustedTheme,
      origin: page.origin,
      source: page.parent,
    }),
  );
  assert.equal(later, false);
  assert.equal(page.classes.has("vscode-dark"), true);
  assert.equal(page.dataset.vscodeThemeKind, "vscode-dark");
  assert.equal(page.style.get("--vscode-editor-background"), "#151517");
});

function nextPortFrame(timeoutMs = 1000): Promise<string> {
  const queued = portFrames[portFrames.length - 1];
  if (queued !== undefined) {
    return Promise.resolve(queued);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      channel.port2.removeEventListener("message", onMessage);
      reject(new Error("timed out waiting for a host-channel frame"));
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      clearTimeout(timer);
      resolve(String(event.data));
    }
    channel.port2.addEventListener("message", onMessage, { once: true });
  });
}

test("a trusted parent SHOWN message is handled and stops later listeners", async () => {
  resetTheme();
  const later = dispatchAndWatch(
    new PageMessageEvent("message", {
      data: SHOWN,
      origin: page.origin,
      source: page.parent,
    }),
  );
  assert.equal(later, false);
  await nextPortFrame();
  assert.deepEqual(
    portFrames.map((text) => JSON.parse(text)),
    [{ ch: "ui", data: { type: "focus" } }],
  );
});

test("a null-source same-origin host RPC event is accepted and not stopped", () => {
  resetTheme();
  const event = new PageMessageEvent("message", {
    data: { id: 1, method: "x" },
    origin: page.origin,
    source: null,
  });
  assert.equal(fromHost(event), true);
  const later = dispatchAndWatch(event);
  assert.equal(later, true);
});

test.after(() => {
  closePorts();
});
