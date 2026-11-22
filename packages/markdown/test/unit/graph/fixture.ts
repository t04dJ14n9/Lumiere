import { createRoot } from "@workshop/core";
import type { Disposer } from "@workshop/core";
import { graphHost } from "../../../src/plugins/graph/host";
import { protocol } from "../../../src/plugins/graph/protocol";
import type { GraphSnapshot } from "../../../src/plugins/graph/snapshot";
import { provideHostServices } from "../../../src/shared/host";
import type { LumierePanel } from "../../../src/shared/host";
import { contributionId } from "../../../src/shared/setting-schema";
import { Endpoint } from "../../../src/shared/rpc/endpoint";
import type { Clock, Transport } from "../../../src/shared/rpc/endpoint";
import { fakeHost } from "../../support/vscode-fake";
import { memoryVaults, uriOf } from "../views/fakes";

export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

const clock: Clock = {
  after(ms, callback) {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};

/** Listeners a panel holds, so a test can see which ones were released. */
class ListenerSet<T> {
  readonly live = new Set<T>();
  add(listener: T): Disposer {
    this.live.add(listener);
    return () => {
      this.live.delete(listener);
    };
  }
}

/** A webview panel whose page is a second RPC endpoint, as the graph's script is. */
export function fakeGraphPanel() {
  const toWebview = new ListenerSet<(message: unknown) => void>();
  const toHost = new ListenerSet<(message: unknown) => void>();
  const visibility = new ListenerSet<(visible: boolean) => void>();
  const disposal = new ListenerSet<() => void>();
  const deliver = (
    listeners: Set<(message: unknown) => void>,
    message: unknown,
  ) =>
    setImmediate(() => {
      for (const listener of listeners) {
        listener(structuredClone(message));
      }
    });
  let disposed = false;
  const panel: LumierePanel = {
    reveal() {},
    setTitle() {},
    visible: true,
    onDidChangeVisibility: (listener) => visibility.add(listener),
    onDispose: (listener) => disposal.add(listener),
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const listener of [...disposal.live]) {
        listener();
      }
    },
    webview: {
      cspSource: "test:",
      asset: (relative) => relative,
      resource: (uri) => uri,
      setHTML() {},
      post: (message) => deliver(toWebview.live, message),
      onMessage: (listener) => toHost.add(listener),
    },
  };
  const transport: Transport = {
    send: (message) => deliver(toHost.live, message),
    listen: (receive) => toWebview.add(receive),
  };
  const page = new Endpoint(transport, clock, undefined, { session: "page" });
  const snapshots: GraphSnapshot[] = [];
  page.on(protocol, "snapshot", (snapshot) => {
    snapshots.push(snapshot as GraphSnapshot);
  });
  return {
    panel,
    page,
    snapshots,
    /** Listeners still registered on this panel by the host. */
    listeners: () =>
      visibility.live.size + disposal.live.size + toHost.live.size,
  };
}

export type FakeGraphPanel = ReturnType<typeof fakeGraphPanel>;

export const VIEW = {
  mode: "global" as const,
  depth: 2,
  colorBy: "type" as const,
  filters: { types: [], tags: [], folders: [], text: "", showOrphans: true },
  relayout: false,
  saved: false,
};

/** The graph plugin over one in-memory vault, with each opened panel recorded. */
export async function graphFixture(notes: Record<string, string>) {
  const memory = memoryVaults(notes);
  const panels: FakeGraphPanel[] = [];
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const host = fakeHost({
    hostCommands: {
      register(id, run) {
        commands.set(id, run);
        return () => {
          commands.delete(id);
        };
      },
    },
    views: {
      panel() {
        const created = fakeGraphPanel();
        panels.push(created);
        return created.panel;
      },
    },
    activeEditor: { note: () => uriOf(Object.keys(notes)[0]!) },
  });
  const root = createRoot({
    logger: { debug() {}, warn() {}, error() {} },
  });
  provideHostServices(root, host);
  root.provide("vaults", memory.vaults);
  root.plugin(graphHost);
  await root.settled();
  return {
    root,
    panels,
    memory,
    async open(): Promise<FakeGraphPanel> {
      await commands.get(contributionId("graph.open"))!();
      await tick();
      return panels.at(-1)!;
    },
  };
}
