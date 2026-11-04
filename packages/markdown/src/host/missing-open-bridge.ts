/**
 * Named untitled bridge for opening a missing Markdown `file:` path in Lumia
 * without creating the workspace file until Save.
 *
 * Tab title before Save comes from the untitled URI path ending in the
 * intended basename (e.g. `untitled:/…/test.md` → tab `test.md`).
 */

/** file: Markdown notes that may use the missing-open bridge. */
export function isMissingMarkdownFileUri(uri: string): boolean {
  return /^file:/i.test(uri) && /\.(md|markdown)$/i.test(uriPath(uri));
}

/** Basename used for the editor tab title (decoded). */
export function basenameForIntendedFileUri(uri: string): string {
  const path = uriPath(uri);
  const slash = path.lastIndexOf("/");
  const name = slash < 0 ? path : path.slice(slash + 1);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/**
 * Untitled URI whose path ends with the intended basename so the tab label
 * is that basename (never `Untitled-N`).
 */
export function untitledBridgeUriFor(intendedFileUri: string): string {
  if (!isMissingMarkdownFileUri(intendedFileUri)) {
    throw new Error("missing-open bridge requires a file Markdown URI");
  }
  const basename = basenameForIntendedFileUri(intendedFileUri);
  // Leading slash keeps Uri path absolute; VS Code labels by basename.
  return `untitled:/${encodeURIComponent(basename).replace(/%2F/gi, "/")}`;
}

/** Maps bridge document URI → intended workspace `file:` URI. */
export class MissingOpenBridge {
  readonly #intended = new Map<string, string>();

  remember(bridgeUri: string, intendedFileUri: string): void {
    if (!isMissingMarkdownFileUri(intendedFileUri)) {
      throw new Error("missing-open bridge intended URI must be Markdown");
    }
    this.#intended.set(bridgeUri, intendedFileUri);
  }

  peek(bridgeUri: string): string | undefined {
    return this.#intended.get(bridgeUri);
  }

  /** Read and clear the intended path for a bridge document (Save path). */
  take(bridgeUri: string): string | undefined {
    const intended = this.#intended.get(bridgeUri);
    if (intended !== undefined) {
      this.#intended.delete(bridgeUri);
    }
    return intended;
  }

  clear(bridgeUri: string): void {
    this.#intended.delete(bridgeUri);
  }
}

function uriPath(uri: string): string {
  // Strip scheme://authority so path-only checks work for file: and untitled:.
  const withoutScheme = uri.replace(/^[a-z][a-z0-9+.-]*:/i, "");
  if (withoutScheme.startsWith("//")) {
    const rest = withoutScheme.slice(2);
    const slash = rest.indexOf("/");
    return slash < 0 ? "" : rest.slice(slash);
  }
  return withoutScheme.startsWith("/") ? withoutScheme : `/${withoutScheme}`;
}
