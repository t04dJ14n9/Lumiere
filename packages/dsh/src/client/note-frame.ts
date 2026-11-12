/**
 * The note and PDF bodies DSH mounts in its preview tab: iframe lifecycle,
 * stale-load handling, theme and open-message wiring. Split from index.ts so
 * each file and function stays inside the lint budget.
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

const READY_GRACE_MS = 11_000;
const FAILED_PREFIX = "Lumiere could not open";
const FAILED_ATTEMPTS = 1;

export interface ReactLike {
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

export function isEditorDocument(
  doc: { querySelector?: (selector: string) => unknown } | null | undefined,
): boolean {
  if (!doc || typeof doc.querySelector !== "function") {
    return false;
  }
  return Boolean(doc.querySelector('meta[name="lumiere-panel"]'));
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
  return (props: BodyProps) => LumiereNote(React, open, props);
}

function LumiereNote(
  React: ReactLike,
  open: (address: string) => void,
  props: BodyProps,
): unknown {
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
  return editorFrame(React, props, {
    frame,
    state: load.current,
    src,
    attempt,
    version: file?.version,
  });
}

/** The editor iframe, with the ref that retires frames DSH replaced. */
function editorFrame(
  React: ReactLike,
  props: BodyProps,
  {
    frame,
    state,
    src,
    attempt,
    version,
  }: {
    frame: { current: HTMLIFrameElement | null };
    state: FrameLoadState;
    src: string;
    attempt: number;
    version: string | undefined;
  },
): unknown {
  return React.createElement("iframe", {
    key: `${src}#${attempt}`,
    ref: (element: HTMLIFrameElement | null) => {
      // React detaches a callback ref with null and re-attaches the same
      // element on every re-render whose identity changed (and on unmount).
      // Keep the live element: its own load/error must still settle the
      // preview. A genuinely replaced element is retired when its successor
      // attaches.
      if (element === null) {
        return;
      }
      const previous = frame.current;
      if (previous && previous !== element) {
        state.retired.add(previous);
      }
      state.attached.add(element);
      frame.current = element;
      state.initialBlank = initialBlankDocument(element);
      props.scrollportRef?.(element);
    },
    src,
    title: "Lumière",
    allow: "clipboard-read; clipboard-write",
    ...frameHandlers(frame, state, props, version),
    style: { border: 0, width: "100%", height: "100%", display: "block" },
  });
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

function initialBlankDocument(
  element: HTMLIFrameElement | null,
): Document | null {
  const doc = element?.contentDocument;
  return doc && doc.URL === "about:blank" ? doc : null;
}

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

export function editorFailed(
  element: { contentDocument?: Document | null } | null | undefined,
): boolean {
  const text = element?.contentDocument?.getElementById("app")?.textContent;
  return Boolean(text && text.startsWith(FAILED_PREFIX));
}

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

function loadedDocument(
  element: HTMLIFrameElement | null,
): Document | null | undefined {
  const doc = element?.contentDocument;
  if (doc?.URL === "about:blank") {
    return undefined;
  }
  return doc ?? null;
}

export function handlePdfFrameLoad(
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

export function sendTheme(frame: HTMLIFrameElement | null): void {
  frame?.contentWindow?.postMessage(readDshTheme(), location.origin);
}

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
