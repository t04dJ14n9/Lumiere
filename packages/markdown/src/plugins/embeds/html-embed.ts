/**
 * What a note shows for an HTML file: a card with its name and two buttons,
 * never the page. Open hands the file to link navigation, which opens it in
 * VS Code's Integrated Browser (a trusted workspace, where the window has one;
 * otherwise, and in Restricted Mode, as text); Open as Text opens the file in a
 * text editor. Community plugins draw the page inside the note, in a frame.
 * VS Code serves a vault file only to its own webview documents, so a frame in
 * the editor's page would stay blank (checked in VS Code 1.147, 2026-11-22), and
 * a page in the editor's own document could not be kept apart from the note.
 */

/** What the card says in Restricted Mode, where Open shows the file as text. */
export const HTML_EMBED_DISABLED_NOTE =
  "Interactive HTML is disabled in Restricted Mode";

export interface MountHtmlCardOptions {
  /** The element the card fills: a `.file-embed`. */
  readonly node: HTMLElement;
  /** The embed's target, with its `#subpath`. */
  readonly target: string;
  /** Whether the workspace is trusted: where it is not, the card says so. */
  readonly trusted: boolean;
  readonly wiki: boolean;
  readonly signal: AbortSignal;
  /** Show the file as a link to it does: in the Integrated Browser, or as text. */
  readonly open: (target: string, wiki: boolean) => void;
  /** Show the file in a text editor. */
  readonly openAsText: (target: string, wiki: boolean) => void;
}

/** The embed's file, as `links.open` takes it: no subpath, no size. */
export function htmlOpenTarget(target: string): string {
  return (target.split("|")[0] ?? "").split("#")[0]?.trim() ?? "";
}

/** The file's name, as the card shows it. */
export function htmlFilename(target: string): string {
  const path = htmlOpenTarget(target);
  const name = path.split("/").at(-1) || path;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** Fill `options.node` with the card of an HTML file. */
export function mountHtmlCard(options: MountHtmlCardOptions): void {
  const { node, target, trusted, wiki, signal } = options;
  const name = htmlFilename(target);
  const file = htmlOpenTarget(target);
  const card = document.createElement("div");
  card.className = "html-embed";
  const title = document.createElement("span");
  title.className = "html-embed-title";
  title.textContent = name;
  card.append(title);
  if (!trusted) {
    const note = document.createElement("span");
    note.className = "html-embed-note";
    note.textContent = HTML_EMBED_DISABLED_NOTE;
    card.classList.add("html-embed-restricted");
    card.append(note);
  }
  card.append(
    button({
      label: "Open",
      aria: `Open ${name}`,
      className: "html-embed-open",
      signal,
      run: () => options.open(file, wiki),
    }),
    button({
      label: "Open as Text",
      aria: `Open ${name} as text`,
      className: "html-embed-open-text",
      signal,
      run: () => options.openAsText(file, wiki),
    }),
  );
  node.replaceChildren(card);
}

function button(options: {
  label: string;
  aria: string;
  className: string;
  signal: AbortSignal;
  run: () => void;
}): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `html-embed-button ${options.className}`;
  element.textContent = options.label;
  element.setAttribute("aria-label", options.aria);
  element.addEventListener(
    "click",
    (event) => {
      // The card is not the note's to select: its buttons are the whole action.
      event.preventDefault();
      event.stopPropagation();
      options.run();
    },
    { signal: options.signal },
  );
  return element;
}
