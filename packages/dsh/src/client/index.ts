/**
 * Lumière's browser half in DSH. Notes in DSH's preview sidebar open in
 * Lumière's editor, a page the host half serves (host/routes.ts), instead of
 * DSH's read-only Markdown preview, which stays in the viewer menu. Written
 * against DSH's plugin module format: React comes from DSH's module table.
 */
import { addressFragment, parentFolder, workspaceRoot } from "./address";
import { handlePdfFrameLoad, noteBody, sendTheme } from "./note-frame";
import { onDshThemeChange } from "./theme";
import type { BodyProps, ReactLike } from "./note-frame";

export {
  editorFailed,
  followOpens,
  isEditorDocument,
  noteBody,
} from "./note-frame";

const ID = "@lumiere/dsh";
const BODY_ID = `${ID}/markdown`;
const PDF_BODY_ID = `${ID}/pdf`;

/** What DSH hands a document body (`sidebar.right.tab.document`). */

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

/**
 * A frame DSH replaced is retired when its ref changes; its queued events must
 * not settle the replacement. A frame not attached yet still reports its own
 * document, so a load from the iframe that fired is never confused with the
 * live ref's document.
 */

/** The iframe's own empty document, before its editor page navigation. */

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

/**
 * HMR can restart the Host while the first page is connecting, so that page's
 * `ready` call times out. Recreate the iframe once to rerun the handshake
 * against the live Host instead of stranding the error in the preview.
 */

/** Same-origin, so the failed bootstrap text is readable from the embedder. */

/** Only the iframe's initial blank document is not an editor page. */

/** An iframe's loaded document, or undefined for its initial about:blank load. */

/** A PDF page carries the same panel meta as an editor page. */

/** The page takes DSH's theme from a theme message (embedding.ts). */

/** The page asks to open another note (a link to it): open it in a DSH tab. */
