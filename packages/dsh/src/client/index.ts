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
