/**
 * Lumière's browser half in DSH. Notes in DSH's preview sidebar open in
 * Lumière's editor, a page the host half serves (host/routes.ts), instead of
 * DSH's read-only Markdown preview, which stays in the viewer menu. Written
 * against DSH's plugin module format: React comes from DSH's module table.
 */
import { parseOpenMessage, SHOWN } from "@workshop/host-node/embedding";
import {
  addressFragment,
  insideWorkspace,
  parentFolder,
  sessionAddress,
  workspaceRoot,
} from "./address";
import { onDshThemeChange, readDshTheme } from "./theme";

const ID = "@lumiere/dsh";
const BODY_ID = `${ID}/markdown`;

interface ReactLike {
  createElement(type: string, props?: Record<string, unknown> | null): unknown;
  useEffect(effect: () => void | (() => void), dependencies?: unknown[]): void;
  useRef<T>(value: T): { current: T };
}

interface FrameEvent {
  readonly currentTarget: HTMLIFrameElement | null;
}

interface FrameLoadState {
  hasLoaded: boolean;
  initialBlank: Document | null;
}

/** What DSH hands a document body (`sidebar.right.tab.document`). */
export interface BodyProps {
  readonly resourceAddress: string;
  readonly sessionId?: string;
  readonly content: {
    readonly kind: string;
    readonly revision?: number;
    loaded?(version: string): void;
    failed?(): void;
  };
  scrollportRef?(element: HTMLElement | null): void;
  useResource(address: string):
    | {
        readonly value?: {
          readonly absolutePath?: string;
          readonly version?: string;
        };
      }
    | undefined;
}

interface ClientContext {
  readonly documentPreviews: { register(definition: unknown): () => void };
  readonly slots: {
    inject(owner: string, register: () => () => void): () => void;
    register(options: unknown, component: unknown): () => void;
  };
  readonly sidebarRight: { openResource(address: string): void };
  effect(start: () => () => void): void;
}

declare global {
  interface Window {
    __ModuleLoader__?: {
      load(module: {
        id: string;
        factory(require: (name: string) => unknown): unknown;
      }): void;
    };
  }
}

/** Whether an iframe's document is a rendered Lumière editor page rather than an HTTP error body. */
export function isEditorDocument(
  doc: { querySelector?: (selector: string) => unknown } | null | undefined,
): boolean {
  if (!doc || typeof doc.querySelector !== "function") {
    return false;
  }
  return Boolean(doc.querySelector('meta[name="lumiere-panel"]'));
}

if (typeof window !== "undefined" && window.__ModuleLoader__) {
  window.__ModuleLoader__.load({
    id: ID,
    factory(require) {
      const React = require("react") as ReactLike;
      return {
        inject: ["documentPreviews", "slots", "sidebarRight"],
        apply(ctx: ClientContext) {
          ctx.effect(() =>
            ctx.documentPreviews.register({
              id: BODY_ID,
              extensions: ["md", "markdown"],
              priority: "extension",
              title: () => "Lumière",
              loading: "renderer",
            }),
          );
          const body = noteBody(React, (address) =>
            ctx.sidebarRight.openResource(address),
          );
          ctx.effect(() =>
            ctx.slots.inject("sidebar.right.tab.document", () =>
              ctx.slots.register(
                { name: "sidebar.right.tab.document", key: BODY_ID },
                body,
              ),
            ),
          );
        },
      };
    },
  });
}

function resolveEditorTarget(
  resourceAddress: string,
  absolute: string | undefined,
) {
  const isMarkdown = Boolean(absolute && /\.(?:md|markdown)$/i.test(absolute));
  const root =
    absolute && isMarkdown
      ? workspaceRoot(resourceAddress, absolute)
      : undefined;
  const containmentRoot =
    root ?? (absolute && isMarkdown ? parentFolder(absolute) : undefined);
  const query =
    absolute && isMarkdown
      ? new URLSearchParams({
          path: absolute,
          ...(containmentRoot ? { root: containmentRoot } : {}),
        })
      : undefined;
  const src = query
    ? `/lumiere/editor?${query.toString()}${addressFragment(resourceAddress)}`
    : undefined;
  return { isMarkdown, root, containmentRoot, src };
}

export function noteBody(React: ReactLike, open: (address: string) => void) {
  return function LumiereNote(props: BodyProps): unknown {
    const frame = React.useRef<HTMLIFrameElement | null>(null);
    const load = React.useRef<FrameLoadState>({
      hasLoaded: false,
      initialBlank: null,
    });
    const file = props.useResource(props.resourceAddress)?.value;
    const absolute = file?.absolutePath;
    const { isMarkdown, root, containmentRoot, src } = resolveEditorTarget(
      props.resourceAddress,
      absolute,
    );
    React.useEffect(() => {
      load.current.hasLoaded = false;
      if (absolute && !isMarkdown) {
        props.content.failed?.();
      }
    }, [src, absolute, isMarkdown]);
    React.useEffect(
      () =>
        followOpens(frame, {
          sessionId: props.sessionId,
          root,
          containmentRoot,
          open,
        }),
      [props.sessionId, root, containmentRoot],
    );
    React.useEffect(() => onDshThemeChange(() => sendTheme(frame.current)), []);
    React.useEffect(() => {
      if (load.current.hasLoaded) {
        props.content.loaded?.(file?.version ?? "lumiere");
      }
    }, [props.content.revision]);
    if (!absolute || !src) {
      return null;
    }
    return React.createElement("iframe", {
      key: src,
      ref: (element: HTMLIFrameElement | null) => {
        frame.current = element;
        load.current.initialBlank = initialBlankDocument(element);
        props.scrollportRef?.(element);
      },
      src,
      title: "Lumière",
      allow: "clipboard-read; clipboard-write",
      ...frameHandlers(frame, load.current, props, file?.version),
      style: { border: 0, width: "100%", height: "100%", display: "block" },
    });
  };
}

function frameHandlers(
  frame: { current: HTMLIFrameElement | null },
  state: FrameLoadState,
  props: BodyProps,
  version: string | undefined,
): {
  onLoad(event: FrameEvent): void;
  onError(event: FrameEvent): void;
} {
  return {
    onLoad: (event) => {
      const element = loadingFrame(event.currentTarget, frame.current);
      if (element) {
        handleFrameLoad(element, state, props, version);
      }
    },
    onError: (event) => {
      if (loadingFrame(event.currentTarget, frame.current)) {
        state.hasLoaded = false;
        props.content.failed?.();
      }
    },
  };
}

/** A load/error from an iframe DSH replaced must not settle its replacement. */
function loadingFrame(
  element: HTMLIFrameElement | null,
  live: HTMLIFrameElement | null,
): HTMLIFrameElement | null {
  return element && element === live ? element : null;
}

/** The iframe's own empty document, before its editor page navigation. */
function initialBlankDocument(
  element: HTMLIFrameElement | null,
): Document | null {
  const doc = element?.contentDocument;
  return doc && doc.URL === "about:blank" ? doc : null;
}

function handleFrameLoad(
  element: HTMLIFrameElement,
  state: FrameLoadState,
  props: BodyProps,
  version: string | undefined,
): void {
  const doc = element.contentDocument;
  // Only the iframe's initial about:blank document is not an editor page.
  // A later blank document is a real navigation or reload and must fail.
  if (
    doc?.URL === "about:blank" &&
    !state.hasLoaded &&
    doc === state.initialBlank
  ) {
    return;
  }
  if (!isEditorDocument(doc)) {
    state.hasLoaded = false;
    props.content.failed?.();
    return;
  }
  state.hasLoaded = true;
  sendTheme(element);
  element.contentWindow?.postMessage(SHOWN, location.origin);
  props.content.loaded?.(version ?? "lumiere");
}

/** The page takes DSH's theme from a theme message (embedding.ts). */
function sendTheme(frame: HTMLIFrameElement | null): void {
  frame?.contentWindow?.postMessage(readDshTheme(), location.origin);
}

/** The page asks to open another note (a link to it): open it in a DSH tab. */
export function followOpens(
  frame: { current: HTMLIFrameElement | null },
  target: {
    sessionId: string | undefined;
    root: string | undefined;
    containmentRoot?: string | undefined;
    open(address: string): void;
  },
): () => void {
  const listener = (event: MessageEvent) => {
    const request =
      event.origin === location.origin &&
      event.source === frame.current?.contentWindow
        ? parseOpenMessage(event.data)
        : undefined;
    const allowedRoot = target.containmentRoot ?? target.root;
    if (
      request &&
      target.sessionId &&
      // A page may only open notes in its own workspace (never when root is unknown).
      insideWorkspace(allowedRoot, request.path)
    ) {
      target.open(
        sessionAddress(
          target.sessionId,
          target.root,
          request.path,
          request.fragment,
        ),
      );
    }
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
