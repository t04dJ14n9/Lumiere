import type { MarkdownWorkshopApi } from "@workshop/markdown/host";
import type { NoteSelections } from "@workshop/pdf/host";

/** The part of a heading `headingPathAt` reads (Lumiere's `HeadingMetadata`). */
interface HeadingLike {
  readonly level: number;
  readonly label: string;
  /** Zero-based, as Lumiere's metadata index counts. */
  readonly position: { readonly start: { readonly line: number } };
}

/**
 * The headings that enclose a line, outermost first. `headings` are in
 * document order; `line` is 1-based.
 */
export function headingPathAt(
  headings: readonly HeadingLike[],
  line: number,
): string[] {
  const path: HeadingLike[] = [];
  for (const heading of headings) {
    if (heading.position.start.line + 1 > line) {
      break;
    }
    while (path.length > 0 && path[path.length - 1]!.level >= heading.level) {
      path.pop();
    }
    path.push(heading);
  }
  return path.map(({ label }) => label);
}

/**
 * Lumiere PDF's agent bridge reads note selections through this adapter
 * over Lumiere's public API. `api` is undefined until Markdown
 * Lumiere has started.
 */
export function markdownNoteSelections(
  api: () => MarkdownWorkshopApi | undefined,
): NoteSelections {
  return {
    hasOpenNotes: () => (api()?.getEditors().length ?? 0) > 0,
    async current() {
      const markdown = api();
      if (!markdown) {
        return undefined;
      }
      // The active note first, then any note with a selection.
      const editors = [...markdown.getEditors()].sort(
        (a, b) => Number(b.isActive) - Number(a.isActive),
      );
      for (const editor of editors) {
        const selection = await markdown
          .getSelection(editor.editorId)
          .catch(() => undefined);
        if (selection?.text) {
          return {
            uri: editor.uri,
            text: selection.text,
            from: selection.from,
            to: selection.to,
            startLine: selection.startLine,
            endLine: selection.endLine,
            isDirty: selection.isDirty,
          };
        }
      }
      return undefined;
    },
    async active() {
      const markdown = api();
      const editor = markdown?.getActiveEditor() ?? markdown?.getEditors()[0];
      if (!markdown || !editor) {
        return undefined;
      }
      const selection = await markdown
        .getSelection(editor.editorId)
        .catch(() => undefined);
      const range = selection?.text
        ? {
            text: selection.text,
            from: selection.from,
            to: selection.to,
            startLine: selection.startLine,
            endLine: selection.endLine,
          }
        : undefined;
      const headings = markdown.getMetadata(editor.uri)?.headings ?? [];
      return {
        uri: editor.uri,
        isDirty: editor.isDirty,
        ...(range ? { selection: range } : {}),
        headingPath: range ? headingPathAt(headings, range.startLine) : [],
      };
    },
  };
}
