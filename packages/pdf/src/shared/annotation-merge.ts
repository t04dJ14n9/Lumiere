/**
 * Merging annotation files (`annotation-store`) that two viewers of the same
 * PDF saved, by annotation. Each viewer sends every one of Lumiere's
 * annotations it shows; the host merges that with the file on disk against
 * what that viewer last had from the host (`base`), as a three-way merge:
 *
 * - one the viewer added or changed since `base` is the viewer's;
 * - one it had in `base` and no longer has, it deleted;
 * - one it still has as `base` had it is left as the file has it, so a
 *   change or a delete made in another pane stands.
 *
 * An annotation is told apart by its `/NM` on its page (Lumiere's get a
 * fresh UUID when made), not by its `ref`: refs are object numbers each
 * viewer's engine hands out, so two panes give different annotations the
 * same one. Refs in the merged file are made unique again, and popups and
 * replies follow the annotation they belong to.
 *
 * Works on the file's JSON as it is: the drawings stay base64, untouched.
 */

type Json = Record<string, unknown>;

interface StoreBundle {
  readonly fields: Json;
  readonly pages: readonly Json[];
  readonly items: readonly Json[];
  readonly resources: Readonly<Record<string, unknown>>;
  /** Each item's identity by its ref in this bundle. */
  readonly ids: ReadonlyMap<string, string>;
}

/** One annotation of a file: its identity, what it says, and where it came from. */
interface Entry {
  readonly id: string;
  /** The item with its refs replaced by the identities they name. */
  readonly content: string;
  readonly item: Json;
  readonly from: StoreBundle;
}

const EMPTY: StoreBundle = {
  fields: {},
  pages: [],
  items: [],
  resources: {},
  ids: new Map(),
};

/** The bundle in a version 2 annotation file; undefined for any other text. */
function parseStoreBundle(text: string): StoreBundle | undefined {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(file) || file.version !== 2 || !isRecord(file.bundle)) {
    return undefined;
  }
  const { pages, items, resources, ...fields } = file.bundle;
  if (
    !Array.isArray(pages) ||
    !Array.isArray(items) ||
    !isRecord(resources) ||
    !pages.every(isRecord) ||
    !items.every((item) => isRecord(item) && isRecord(item.data))
  ) {
    return undefined;
  }
  const ids = new Map(
    (items as Json[]).map((item) => [refKey(dataOf(item).ref), identity(item)]),
  );
  return {
    fields,
    pages: pages as Json[],
    items: items as Json[],
    resources,
    ids,
  };
}

/** No file is an empty one; undefined when the text is not a version 2 file. */
function bundleOf(text: string | undefined): StoreBundle | undefined {
  return text === undefined ? EMPTY : parseStoreBundle(text);
}

/**
 * The file after a viewer's save: `disk` as it is now, `base` what the
 * viewer last had from the host, `mine` what it sends (undefined: none).
 * Returns the text to write, undefined for no file, or `mine` unchanged
 * when the file or the save is not a version 2 file and so cannot be
 * merged (an old file being replaced), which is what a save did before.
 */
export function mergeAnnotationFile(
  disk: string | undefined,
  base: string | undefined,
  mine: string | undefined,
): string | undefined {
  const diskBundle = bundleOf(disk);
  const mineBundle = bundleOf(mine);
  if (!diskBundle || !mineBundle) {
    return mine;
  }
  // A base that cannot be read only loses the viewer's deletes, never an annotation.
  const before = entriesOf(bundleOf(base) ?? EMPTY);
  const own = entriesOf(mineBundle);
  const merged = new Map(entriesOf(diskBundle));
  for (const id of before.keys()) {
    if (!own.has(id)) {
      merged.delete(id);
    }
  }
  // One the viewer has as it had it keeps the file's version, or its absence.
  for (const [id, entry] of own) {
    if (before.get(id)?.content !== entry.content) {
      merged.set(id, entry);
    }
  }
  return writeBundle([...merged.values()], [diskBundle, mineBundle]);
}

/**
 * The annotations in a file's text by identity, with what each says and its
 * ref in that file; undefined when the text is not a version 2 file. A
 * viewer compares what it shows with this to apply another pane's changes.
 */
export function annotationEntries(
  text: string | undefined,
): Map<string, { content: string; ref: unknown }> | undefined {
  const bundle = bundleOf(text);
  if (!bundle) {
    return undefined;
  }
  return new Map(
    [...entriesOf(bundle)].map(([id, entry]) => [
      id,
      { content: entry.content, ref: dataOf(entry.item).ref },
    ]),
  );
}

/**
 * Whether two annotation files hold the same annotations, each saying the
 * same, however they are written out (a merge writes refs and fields anew).
 * Texts that are not version 2 files are the same only when equal.
 */
export function sameAnnotations(
  a: string | undefined,
  b: string | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  const left = annotationEntries(a);
  const right = annotationEntries(b);
  if (!left || !right || left.size !== right.size) {
    return false;
  }
  return [...left].every(
    ([id, entry]) => right.get(id)?.content === entry.content,
  );
}

function entriesOf(bundle: StoreBundle): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  for (const item of bundle.items) {
    const id = identity(item);
    const content = JSON.stringify(
      withRefs(item, (ref) => bundle.ids.get(refKey(ref))),
    );
    entries.set(id, { id, content, item, from: bundle });
  }
  return entries;
}

/** `/NM` on its page; an annotation without one is told apart by what it says. */
function identity(item: Json): string {
  const data = dataOf(item);
  const page = JSON.stringify(refPage(data.ref) ?? null);
  if (typeof data.nm === "string" && data.nm !== "") {
    return `nm ${page} ${data.nm}`;
  }
  return `body ${JSON.stringify(withRefs(item, () => undefined))}`;
}

/**
 * The item without its own ref, and the refs it points at (a popup's
 * parent, a reply's target) given by `point`.
 */
function withRefs(item: Json, point: (ref: unknown) => unknown): Json {
  const data = { ...dataOf(item) };
  delete data.ref;
  if ("parent" in data) {
    data.parent = point(data.parent) ?? null;
  }
  if (isRecord(data.reply)) {
    data.reply = { ...data.reply, to: point(data.reply.to) ?? null };
  }
  return { ...item, data };
}

/** The merged entries as a file: unique refs, and only the drawings they name. */
function writeBundle(
  entries: readonly Entry[],
  sources: readonly StoreBundle[],
): string | undefined {
  const refs = assignRefs(entries);
  const items = entries.flatMap((entry) => {
    const item = relink(entry, refs);
    return item ? [item] : [];
  });
  if (items.length === 0) {
    return undefined;
  }
  const pages = mergedPages(sources);
  const position = new Map(
    pages.map((page) => [JSON.stringify(page.page), Number(page.position)]),
  );
  const pageOf = (item: Json): number =>
    position.get(JSON.stringify(refPage(dataOf(item).ref))) ?? 0;
  items.sort((a, b) => pageOf(a) - pageOf(b));
  const bundle = {
    ...sources[0]?.fields,
    ...sources[1]?.fields,
    pages,
    items,
    resources: namedResources(items, sources),
  };
  return `${JSON.stringify({ version: 2, bundle }, null, 2)}\n`;
}

/**
 * Each annotation's ref in the merged file, by identity. The first to hold
 * an object number keeps it; another that has the same one gets a new one.
 */
function assignRefs(entries: readonly Entry[]): Map<string, Json> {
  let next = 1;
  for (const entry of entries) {
    const ref = dataOf(entry.item).ref;
    if (isRecord(ref) && typeof ref.objectNumber === "number") {
      next = Math.max(next, ref.objectNumber + 1);
    }
  }
  const taken = new Set<string>();
  const refs = new Map<string, Json>();
  for (const entry of entries) {
    const ref = dataOf(entry.item).ref as Json;
    const assigned = taken.has(refKey(ref))
      ? { kind: "objectNumber", page: ref.page, objectNumber: next++ }
      : ref;
    taken.add(refKey(assigned));
    refs.set(entry.id, assigned);
  }
  return refs;
}

/**
 * The item with its new ref, and the refs it points at moved to where those
 * annotations are now; undefined for a popup or reply whose annotation is
 * gone, which the engine deletes with it.
 */
function relink(
  entry: Entry,
  refs: ReadonlyMap<string, Json>,
): Json | undefined {
  let orphan = false;
  const point = (target: unknown): unknown => {
    const id = entry.from.ids.get(refKey(target));
    const moved = id === undefined ? undefined : refs.get(id);
    orphan ||= moved === undefined;
    return moved;
  };
  const data: Json = { ...dataOf(entry.item), ref: refs.get(entry.id) };
  if (isRecord(data.parent)) {
    data.parent = point(data.parent);
  }
  if (isRecord(data.reply) && isRecord(data.reply.to)) {
    data.reply = { ...data.reply, to: point(data.reply.to) };
  }
  return orphan ? undefined : { ...entry.item, data };
}

/** Every page either file lists, once, in page order. */
function mergedPages(sources: readonly StoreBundle[]): Json[] {
  const pages = new Map<string, Json>();
  for (const source of sources) {
    for (const page of source.pages) {
      const key = JSON.stringify(page.page);
      if (!pages.has(key)) {
        pages.set(key, page);
      }
    }
  }
  return [...pages.values()].sort(
    (a, b) => Number(a.position) - Number(b.position),
  );
}

/** The drawings the items name, from whichever file has them (an id is its hash). */
function namedResources(
  items: readonly Json[],
  sources: readonly StoreBundle[],
): Record<string, unknown> {
  const named = new Set<string>();
  for (const item of items) {
    if (isRecord(item.resources)) {
      for (const id of Object.values(item.resources)) {
        named.add(String(id));
      }
    }
  }
  const resources: Record<string, unknown> = {};
  for (const id of [...named].sort()) {
    const source = sources.find((bundle) =>
      Object.hasOwn(bundle.resources, id),
    );
    if (source) {
      resources[id] = source.resources[id];
    }
  }
  return resources;
}

function dataOf(item: Json): Json {
  return item.data as Json;
}

function refPage(ref: unknown): unknown {
  return isRecord(ref) ? ref.page : undefined;
}

function refKey(ref: unknown): string {
  if (!isRecord(ref)) {
    return "";
  }
  return JSON.stringify([ref.page, ref.kind, ref.objectNumber, ref.baseIndex]);
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
