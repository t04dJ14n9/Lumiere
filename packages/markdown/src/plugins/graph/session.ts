import type { Context, Disposer, Infer } from "@workshop/core";
import { Endpoint } from "../../shared/rpc/endpoint";
import type { Clock, Transport } from "../../shared/rpc/endpoint";
import type { WorkbenchViews, WorkshopPanel } from "../../shared/host";
import { contributionId } from "../../shared/setting-schema";
import type { Vault } from "../vault/api";
import { resolveScope } from "./choose";
import type { HeldScope } from "./choose";
import { collectNotes } from "./collect";
import { emptyFilters } from "./filters";
import type { GraphFilters } from "./filters";
import { graphPanelHtml } from "./html";
import { protocol } from "./protocol";
import { readGraphSettings } from "./settings";
import { emptySnapshot, presentSnapshot } from "./snapshot";
import type { GraphSnapshot } from "./snapshot";

const VIEW_TYPE = contributionId("graph");
const DEBOUNCE_MS = 300;

type ViewParams = Infer<(typeof protocol.requests)["view"]["params"]>;
type OpenParams = Infer<(typeof protocol.requests)["open"]["params"]>;

interface ViewState {
  mode: "global" | "local";
  depth: number;
  colorBy: "type" | "folder" | "tag";
  filters: GraphFilters;
  focusId?: string;
}

interface SessionState {
  ctx: Context;
  view: ViewState;
  scope: HeldScope | undefined;
  panel: WorkshopPanel | undefined;
  endpoint: Endpoint | undefined;
  /** Stops what the host listens to on the current panel. */
  release: (() => void) | undefined;
  generation: number;
  admitted: Set<string>;
  timer: ReturnType<typeof setTimeout> | undefined;
  ticket: number;
}

export interface GraphSession {
  open(): Promise<void>;
  choose(): Promise<void>;
  schedule(): void;
  dispose(): void;
}

const clock: Clock = {
  after(ms, callback) {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};

/** One graph panel. Scope stays on the vault chosen at open until the user picks again. */
export function createGraphSession(ctx: Context): GraphSession {
  const settings = readGraphSettings(ctx.settings);
  const state: SessionState = {
    ctx,
    view: {
      mode: settings.mode,
      depth: settings.depth,
      colorBy: settings.colorBy,
      filters: emptyFilters(),
    },
    scope: undefined,
    panel: undefined,
    endpoint: undefined,
    release: undefined,
    generation: 0,
    admitted: new Set(),
    timer: undefined,
    ticket: 0,
  };
  return {
    open: () => openPanel(state, false),
    choose: () => openPanel(state, true),
    schedule: () => schedule(state),
    dispose: () => dispose(state),
  };
}

async function openPanel(
  state: SessionState,
  explicit: boolean,
): Promise<void> {
  ensurePanel(state, state.ctx.views);
  const chosen = await resolveScope({
    ctx: state.ctx,
    explicit,
    ...(state.scope ? { current: state.scope } : {}),
  });
  if (chosen === "dismissed") {
    return;
  }
  state.scope = chosen;
  state.panel?.setTitle(chosen ? `Graph: ${chosen.scope.name}` : "Vault Graph");
  await publish(state);
}

function ensurePanel(state: SessionState, views: WorkbenchViews): void {
  if (state.panel) {
    state.panel.reveal();
    return;
  }
  const panel = views.panel(VIEW_TYPE, "Vault Graph");
  const endpoint = new Endpoint(
    panelTransport(panel),
    clock,
    state.ctx.logger,
    {
      session: crypto.getRandomValues(new Uint32Array(4)).join("-"),
      restartOn: "graph/ready",
    },
  );
  state.panel = panel;
  state.endpoint = endpoint;
  registerPanel(state, panel, endpoint);
  panel.webview.setHTML(
    graphPanelHtml({
      cspSource: panel.webview.cspSource,
      script: panel.webview.asset("webview/graph.js"),
      style: panel.webview.asset("webview/graph.css"),
      worker: panel.webview.asset("webview/graph-layout.js"),
    }),
  );
}

/**
 * The panel's handlers and listeners last as long as the panel, not the
 * plugin: each reopened panel would otherwise leave its closures behind
 * until the plugin stops. The plugin's own stop disposes the session, which
 * detaches the current panel the same way.
 */
function registerPanel(
  state: SessionState,
  panel: WorkshopPanel,
  endpoint: Endpoint,
): void {
  const stops: Disposer[] = [
    endpoint.handle(protocol, "ready", (params) => {
      if (params.saved) {
        applyView(state, params);
      }
      void publish(state);
      return {};
    }),
    endpoint.handle(protocol, "view", (params) => {
      applyView(state, params);
      void publish(state);
      return {};
    }),
    endpoint.handle(protocol, "open", async (params) => ({
      opened: await openNode(state, params),
    })),
    panel.onDidChangeVisibility((visible) => {
      if (!visible) {
        state.endpoint?.notify(protocol, "stopLayout", {});
        return;
      }
      void publish(state);
    }),
    panel.onDispose(() => detach(state, endpoint)),
  ];
  state.release = () => {
    for (const stop of stops.splice(0)) {
      void stop();
    }
    void endpoint.dispose();
  };
}

function panelTransport(panel: WorkshopPanel): Transport {
  return {
    send: (message) => panel.webview.post(message),
    listen: (receive) => panel.webview.onMessage(receive),
  };
}

function applyView(state: SessionState, params: ViewParams): void {
  state.view = {
    mode: params.mode,
    depth: clampDepth(params.depth),
    colorBy: params.colorBy,
    filters: copyFilters(params.filters),
    ...(params.focusId ? { focusId: params.focusId } : {}),
    ...(state.view.focusId && !params.focusId
      ? { focusId: state.view.focusId }
      : {}),
  };
}

function clampDepth(depth: number): number {
  if (!Number.isFinite(depth)) {
    return 2;
  }
  return Math.min(3, Math.max(1, Math.floor(depth)));
}

function copyFilters(filters: ViewParams["filters"]): GraphFilters {
  return {
    types: filters.types,
    tags: filters.tags,
    folders: filters.folders,
    text: filters.text,
    showOrphans: filters.showOrphans,
  };
}

async function publish(state: SessionState): Promise<void> {
  const endpoint = state.endpoint;
  if (!endpoint) {
    return;
  }
  const ticket = ++state.ticket;
  try {
    const snapshot = await buildSnapshot(state, ticket);
    if (!snapshot || ticket !== state.ticket || state.endpoint !== endpoint) {
      return;
    }
    remember(state, snapshot);
    endpoint.notify(protocol, "snapshot", snapshot, { coalesce: true });
  } catch (error) {
    state.ctx.logger.error("Vault graph update failed", error);
  }
}

async function buildSnapshot(
  state: SessionState,
  ticket: number,
): Promise<GraphSnapshot | undefined> {
  const generation = ++state.generation;
  const scope = state.scope;
  if (!scope) {
    return emptySnapshot(generation);
  }
  await scope.vault.settled();
  if (ticket !== state.ticket) {
    return undefined;
  }
  const collected = collectNotes(scope.vault);
  const settings = readGraphSettings(state.ctx.settings);
  return presentSnapshot({
    scope: scope.scope,
    notes: collected.notes,
    resolve: (linktext, sourcePath, syntax) =>
      resolve(scope.vault, linktext, sourcePath, syntax),
    completeness: collected.completeness,
    generation,
    mode: state.view.mode,
    depth: state.view.depth,
    colorBy: state.view.colorBy,
    filters: state.view.filters,
    ...(focusOption(state, scope) ?? {}),
    maxNodes: settings.maxNodes,
    maxEdges: settings.maxEdges,
  });
}

function focusOption(
  state: SessionState,
  scope: HeldScope,
): { focusPath: string } | undefined {
  const focusPath = state.view.focusId ?? scope.focusPath;
  if (!focusPath) {
    return undefined;
  }
  return { focusPath };
}

function resolve(
  vault: Vault,
  linktext: string,
  sourcePath: string,
  syntax: "markdown" | "wikilink",
): { status: "file" | "missing"; path?: string } {
  const file = vault.index.resolveLink(linktext, sourcePath, syntax);
  if (!file) {
    return { status: "missing" };
  }
  return { status: "file", path: file.path };
}

function remember(state: SessionState, snapshot: GraphSnapshot): void {
  state.admitted = new Set(snapshot.nodes.map((node) => node.id));
}

async function openNode(
  state: SessionState,
  params: OpenParams,
): Promise<boolean> {
  const scope = state.scope;
  if (!scope || params.scopeId !== scope.scope.id) {
    return false;
  }
  if (params.generation !== state.generation) {
    return false;
  }
  if (!state.admitted.has(params.nodeId)) {
    return false;
  }
  const file = scope.vault.index.file(params.nodeId);
  if (!file) {
    return false;
  }
  await state.ctx.vaults.open(file.uri);
  state.view.focusId = params.nodeId;
  if (state.view.mode === "local") {
    void publish(state);
  }
  return true;
}

function schedule(state: SessionState): void {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.timer = setTimeout(() => {
    state.timer = undefined;
    void publish(state);
  }, DEBOUNCE_MS);
}

function dispose(state: SessionState): void {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.ticket += 1;
  const panel = state.panel;
  detach(state, state.endpoint);
  panel?.dispose();
}

function detach(state: SessionState, endpoint: Endpoint | undefined): void {
  if (state.endpoint !== endpoint) {
    return;
  }
  const release = state.release;
  state.panel = undefined;
  state.endpoint = undefined;
  state.release = undefined;
  release?.();
}
