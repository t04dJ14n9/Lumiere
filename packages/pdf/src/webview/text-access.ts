import {
  createCapabilityToken,
  definePlugin,
  useOptionalCapability,
  type PageRef,
} from "@embedpdf/react/runtime";
import type { PageTextSnapshot, TextLayout, TextRange } from "@embedpdf/engine";

/**
 * A page's text, for the parts of the viewer that read it directly: where
 * its words and lines are (Look Up, backlink overlays, region text) and what
 * it says. EmbedPDF 3 only hands out its text geometry to plugins, through
 * the document they are bound to, so this plugin is the one door.
 */
export interface TextAccess {
  /** Where the page's characters are, in page space. Needs `doc.text.select`. */
  layoutOf(page: PageRef): Promise<TextLayout>;
  /** The page's text and its character-to-string map. Needs `doc.text.copy`. */
  textOf(page: PageRef): Promise<PageTextSnapshot>;
  /** The text of a character range. Needs `doc.text.copy`. */
  slice(page: PageRef, range: TextRange): Promise<string>;
}

export const TextAccessToken = createCapabilityToken<TextAccess>("lumia-text", {
  hint: "add lumiaTextPlugin() to the viewer's plugins",
  // A stand-in without a document rejects, so a caller's `.catch` sees it.
  promises: { layoutOf: true, textOf: true, slice: true },
});

/**
 * The text of the open page, or null until the document is ready (the
 * viewer's hooks run before it is).
 */
export function useTextAccess(): TextAccess | null {
  return useOptionalCapability(TextAccessToken);
}

/**
 * Lumiere only ever adds annotations, which change neither the characters nor
 * their boxes, so what is read once per page is kept for the document's life.
 * A read that fails (copy forbidden, page gone) is forgotten, so a later
 * ask tries again.
 */
export const lumiaTextPlugin = () =>
  definePlugin({
    id: "lumia-text",
    token: TextAccessToken,
    scope: "document",
    create: (ctx) => {
      const layouts = new Map<number, Promise<TextLayout>>();
      const texts = new Map<number, Promise<PageTextSnapshot>>();
      const once = <Value>(
        cache: Map<number, Promise<Value>>,
        page: PageRef,
        read: () => Promise<Value>,
      ): Promise<Value> => {
        const cached = cache.get(page.objectNumber);
        if (cached) {
          return cached;
        }
        const pending = read();
        cache.set(page.objectNumber, pending);
        pending.catch(() => cache.delete(page.objectNumber));
        return pending;
      };
      return {
        api: {
          layoutOf: (page) =>
            once(layouts, page, () => ctx.doc.page(page).text.layout()),
          textOf: (page) =>
            once(texts, page, () => ctx.doc.page(page).text.get()),
          slice: (page, range) => ctx.doc.page(page).text.slice(range),
        },
      };
    },
  });
