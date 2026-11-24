/**
 * Cursor can open dirty or agent-edited notes in its built-in Markdown editor
 * yet fail when transferring them into a CustomTextEditorProvider. That handoff
 * asserts "Argument is 'undefined' or 'null.'" before resolveCustomTextEditor.
 * Reissuing openTextDocument before the handoff warms the host document model.
 *
 * See https://forum.cursor.com/t/assertion-error-when-using-custom-editors-incl-markdown-preview-editors/148578
 */

/** Auto mode matches reclaim: only Cursor needs the warm. */
export function documentWarmEnabled({
  mode,
  appName,
}: {
  mode: "auto" | "on" | "off";
  appName: string;
}): boolean {
  if (mode === "auto") {
    return /cursor/i.test(appName);
  }
  return mode === "on";
}

const MARKDOWN_NOTE = /\.(md|markdown)$/i;

/** Notes on disk that our custom editor may open. */
export function isWarmableMarkdown(uri: string): boolean {
  return /^file:/i.test(uri) && MARKDOWN_NOTE.test(uri);
}

/** What a Git change's URI offers before it is made a string. */
interface ChangedUri {
  readonly scheme: string;
  readonly path: string;
  toString(): string;
}

/**
 * The warmable notes among changes, as URI strings made one at a time as the
 * caller reads on. A repository can report tens of thousands of changes and
 * `toString()` is the costly part of each; the path says at once whether a
 * change is a note (`isWarmableMarkdown` still has the last word).
 */
export function* markdownChangeUris(
  changeLists: Iterable<Iterable<{ readonly uri: ChangedUri }>>,
): Generator<string> {
  for (const changes of changeLists) {
    for (const { uri } of changes) {
      if (uri.scheme === "file" && MARKDOWN_NOTE.test(uri.path)) {
        yield uri.toString();
      }
    }
  }
}

/**
 * Whether a watcher or Git target needs warming. Document-open events and
 * foreground handoffs reissue the open even for an already-open document.
 */
export function shouldWarmUri(
  uri: string,
  openUris: ReadonlySet<string>,
): boolean {
  return isWarmableMarkdown(uri) && !openUris.has(uri);
}

/**
 * Deduplicated warmable change URIs that still need materialization.
 * Already-open entries are omitted so they do not consume a warm budget.
 * Collecting stops at `limit` targets, without reading the changes after
 * them (a lazy `changeUris` is never advanced past its last target).
 */
export function collectGitWarmTargets(
  changeUris: Iterable<string>,
  openUris: ReadonlySet<string>,
  limit = Number.POSITIVE_INFINITY,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (limit <= 0) {
    return out;
  }
  for (const uri of changeUris) {
    if (seen.has(uri) || !shouldWarmUri(uri, openUris)) {
      continue;
    }
    seen.add(uri);
    out.push(uri);
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

/**
 * Next concurrency batch from a drained target list. `limit` is a batch size,
 * not a permanently selected prefix of the dirty set.
 */
export function nextWarmBatch(
  targets: readonly string[],
  offset: number,
  limit: number,
): { batch: readonly string[]; nextOffset: number } {
  const batch = targets.slice(offset, offset + Math.max(0, limit));
  return { batch, nextOffset: offset + batch.length };
}
