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
const PDF_BODY_ID = `${ID}/pdf`;
/** The editor's `ready` call gives up after 10 s; check just after that. */
const READY_GRACE_MS = 11_000;
/** Written into the page by the webview when its bootstrap fails (main.ts). */
const FAILED_PREFIX = "Lumiere could not open";
const FAILED_ATTEMPTS = 1;

interface ReactLike {
  createElement(type: string, props?: Record<string, unknown> | null): unknown;
  useEffect(effect: () => void | (() => void), dependencies?: unknown[]): void;
  useRef<T>(value: T): { current: T };
  useState<T>(value: T): [T, (value: T) => void];
}

interface FrameEvent {
  readonly currentTarget: HTMLIFrameElement | null;
}

interface FrameLoadState {
  hasLoaded: boolean;
  initialBlank: Document | null;
  attached: Set<HTMLIFrameElement>;
  retired: Set<HTMLIFrameElement>;
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
          ctx.effect(() =>
            ctx.documentPreviews.register({
              id: PDF_BODY_ID,
              extensions: ["pdf"],
              binaryExtensions: ["pdf"],
              priority: "extension",
              title: () => "Lumière PDF",
              loading: "renderer",
            }),
          );
          ctx.effect(() =>
            ctx.slots.inject("sidebar.right.tab.document", () =>
              ctx.slots.register(
                { name: "sidebar.right.tab.document", key: PDF_BODY_ID },
                pdfBody(React),
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
      attached: new Set(),
      retired: new Set(),
    });
    const [attempt, retry] = React.useState(0);
    const file = props.useResource(props.resourceAddress)?.value;
    const absolute = file?.absolutePath;
    const { isMarkdown, root, containmentRoot, src } = resolveEditorTarget(
      props.resourceAddress,
      absolute,
    );
    React.useEffect(() => {
      load.current.hasLoaded = false;
      load.current.initialBlank = null;
      if (absolute && !isMarkdown) {
        props.content.failed?.();
      }
    }, [src, absolute, isMarkdown, attempt]);
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
    watchReady(React, { frame, src, attempt, retry });
    watchReload(React, {
      frame,
      state: load,
      content: props.content,
      version: file?.version,
      attempt,
      retry,
    });
    if (!absolute || !src) {
      return null;
    }
    return React.createElement("iframe", {
      key: `${src}#${attempt}`,
      ref: (element: HTMLIFrameElement | null) => {
        const previous = frame.current;
        if (previous && previous !== element) {
          load.current.retired.add(previous);
        }
        if (element) {
          load.current.attached.add(element);
        }
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
      const element = loadingFrame(event.currentTarget, frame.current, state);
      if (element) {
        handleFrameLoad(element, state, props, version);
      }
    },
    onError: (event) => {
      if (loadingFrame(event.currentTarget, frame.current, state)) {
        state.hasLoaded = false;
        props.content.failed?.();
      }
    },
  };
}

/**
 * A frame DSH replaced is retired when its ref changes; its queued events must
 * not settle the replacement. A frame not attached yet still reports its own
 * document, so a load from the iframe that fired is never confused with the
 * live ref's document.
 */
function loadingFrame(
  element: HTMLIFrameElement | null,
  live: HTMLIFrameElement | null,
  state: FrameLoadState,
): HTMLIFrameElement | null {
  if (!element || state.retired.has(element)) {
    return null;
  }
  return state.attached.has(element) && element !== live ? null : element;
}

/** The iframe's own empty document, before its editor page navigation. */
function initialBlankDocument(
  element: HTMLIFrameElement | null,
): Document | null {
  const doc = element?.contentDocument;
  return doc && doc.URL === "about:blank" ? doc : null;
}

/** PDFs open in Lumière's viewer page, served by the host's PDF routes. */
export function pdfBody(React: ReactLike) {
  return (props: BodyProps): unknown => {
    const frame = React.useRef<HTMLIFrameElement | null>(null);
    React.useEffect(() => onDshThemeChange(() => sendTheme(frame.current)), []);
    const file = props.useResource(props.resourceAddress)?.value;
    const absolute = file?.absolutePath;
    if (!absolute || !/\.pdf$/i.test(absolute)) {
      return null;
    }
    const root =
      workspaceRoot(props.resourceAddress, absolute) ?? parentFolder(absolute);
    const query = new URLSearchParams({
      path: absolute,
      ...(root ? { root } : {}),
    });
    const src = `/lumiere/pdf?${query.toString()}${addressFragment(props.resourceAddress)}`;
    return React.createElement("iframe", {
      // DSH's reload bumps content.revision; a new iframe asks the host for
      // the PDF again and reports the new revision through its load event.
      key: `${src}#${props.content.revision ?? 0}`,
      ref: (element: HTMLIFrameElement | null) => {
        frame.current = element;
        props.scrollportRef?.(element);
      },
      src,
      title: "Lumière PDF",
      onLoad: (event: { currentTarget: HTMLIFrameElement | null }) =>
        handlePdfFrameLoad(event.currentTarget, props, file?.version),
      onError: () => props.content.failed?.(),
      style: { border: 0, width: "100%", height: "100%", display: "block" },
    });
  };
}

/**
 * DSH's Reload and "Read the file again" bump `content.revision`. Ordinary
 * revisions only report the loaded version; one that arrives while the page is
 * stuck on its bootstrap error also recreates the iframe, so those controls
 * can actually recover a preview that failed its first `ready` handshake.
 */
function watchReload(
  React: ReactLike,
  options: {
    frame: { current: HTMLIFrameElement | null };
    state: { current: FrameLoadState };
    content: BodyProps["content"];
    version: string | undefined;
    attempt: number;
    retry(value: number): void;
  },
): void {
  const last = React.useRef(options.content.revision);
  React.useEffect(() => {
    if (options.state.current.hasLoaded) {
      options.content.loaded?.(options.version ?? "lumiere");
    }
    if (options.content.revision === last.current) {
      return;
    }
    last.current = options.content.revision;
    if (editorFailed(options.frame.current)) {
      options.retry(options.attempt + 1);
    }
  }, [options.content.revision, options.attempt]);
}

/**
 * HMR can restart the Host while the first page is connecting, so that page's
 * `ready` call times out. Recreate the iframe once to rerun the handshake
 * against the live Host instead of stranding the error in the preview.
 */
function watchReady(
  React: ReactLike,
  options: {
    frame: { current: HTMLIFrameElement | null };
    src: string | undefined;
    attempt: number;
    retry(value: number): void;
  },
): void {
  React.useEffect(() => {
    if (!options.src || options.attempt >= FAILED_ATTEMPTS) {
      return;
    }
    const timer = setTimeout(() => {
      if (editorFailed(options.frame.current)) {
        options.retry(options.attempt + 1);
      }
    }, READY_GRACE_MS);
    return () => clearTimeout(timer);
  }, [options.src, options.attempt]);
}

/** Same-origin, so the failed bootstrap text is readable from the embedder. */
export function editorFailed(
  element: { contentDocument?: Document | null } | null | undefined,
): boolean {
  const text = element?.contentDocument?.getElementById("app")?.textContent;
  return Boolean(text && text.startsWith(FAILED_PREFIX));
}

/** Only the iframe's initial blank document is not an editor page. */
function isInitialBlank(state: FrameLoadState, doc: Document | null): boolean {
  if (doc?.URL !== "about:blank" || state.hasLoaded) {
    return false;
  }
  return state.initialBlank === null
    ? state.attached.size === 0
    : doc === state.initialBlank;
}

function handleFrameLoad(
  element: HTMLIFrameElement,
  state: FrameLoadState,
  props: BodyProps,
  version: string | undefined,
): void {
  const doc = element.contentDocument;
  if (isInitialBlank(state, doc)) {
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

/** An iframe's loaded document, or undefined for its initial about:blank load. */
function loadedDocument(
  element: HTMLIFrameElement | null,
): Document | null | undefined {
  const doc = element?.contentDocument;
  if (doc?.URL === "about:blank") {
    return undefined;
  }
  return doc ?? null;
}

/** A PDF page carries the same panel meta as an editor page. */
function handlePdfFrameLoad(
  element: HTMLIFrameElement | null,
  props: BodyProps,
  version: string | undefined,
): void {
  const doc = loadedDocument(element);
  if (doc === undefined) {
    return;
  }
  if (!isEditorDocument(doc)) {
    props.content.failed?.();
    return;
  }
  sendTheme(element);
  props.content.loaded?.(version ?? "lumiere-pdf");
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
