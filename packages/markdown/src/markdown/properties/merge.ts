import type { Document } from "yaml";
import { loadYaml } from "./load-yaml";
import { headerParts, frontmatter } from "./frontmatter";
import {
  sameWritten,
  scalarValue,
  valueAfterKey,
  yamlKey,
  type PropertyChange,
} from "./yaml-value";
import { setPropertyChanges } from "./alias-edits";
import { appendedListItems } from "./list-append";
import { validPropertyName } from "./types";
function propertyObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clipboardValue(
  value: unknown,
  ancestors = new Set<object>(),
): boolean {
  if (scalarValue(value)) {
    return true;
  }
  if (!value || typeof value !== "object" || ancestors.has(value)) {
    return false;
  }
  ancestors.add(value);
  const valid = Object.values(value).every((item) =>
    clipboardValue(item, ancestors),
  );
  ancestors.delete(value);
  return valid;
}

/**
 * Both lists' items, each once, in order. Items are compared by value, so
 * an object (`- name: a`) in both lists is not written twice.
 */
function joinedLists(current: unknown[], incoming: unknown[]): unknown[] {
  const seen = new Set<string>();
  return [...current, ...incoming].filter((item) => {
    const key = valueKey(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * A text equal for equal values: keys sorted, types kept apart (`1`, `"1"`;
 * `.nan`, `.inf`, `-.inf` and `null`, which JSON writes alike; a date and its
 * text).
 */
function valueKey(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(valueKey).join(",")}]`;
  }
  if (propertyObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${valueKey(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return `number:${String(value)}`;
  }
  if (value instanceof Date) {
    return `date:${value.toISOString()}`;
  }
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function mergeValue(current: unknown, incoming: unknown): unknown {
  if (!current) {
    return incoming;
  }
  if (Array.isArray(current) && Array.isArray(incoming)) {
    return joinedLists(current as unknown[], incoming as unknown[]);
  }
  if (propertyObject(current) && propertyObject(incoming)) {
    const entries = new Map(Object.entries(current));
    for (const [key, value] of Object.entries(incoming)) {
      entries.set(key, mergeValue(entries.get(key), value));
    }
    return Object.fromEntries(entries);
  }
  return incoming === null ? current : incoming;
}

/**
 * How a template's properties join a note's: a value the note already has
 * stays, a missing or empty one is added, and lists (and nested maps) are
 * joined without duplicates.
 */
function keepExistingValue(current: unknown, incoming: unknown): unknown {
  if (current === undefined || current === null || current === "") {
    return incoming;
  }
  if (Array.isArray(current) && Array.isArray(incoming)) {
    return joinedLists(current as unknown[], incoming as unknown[]);
  }
  if (propertyObject(current) && propertyObject(incoming)) {
    const entries = new Map(Object.entries(current));
    for (const [key, value] of Object.entries(incoming)) {
      entries.set(key, keepExistingValue(entries.get(key), value));
    }
    return Object.fromEntries(entries);
  }
  return current;
}

export interface MergeOptions {
  /**
   * Keep the note's values and only add what it lacks (Insert Template);
   * by default incoming values replace scalars (a property paste).
   */
  keepExisting?: boolean;
}

function mergerFor(
  options: MergeOptions | undefined,
): (current: unknown, incoming: unknown) => unknown {
  return options?.keepExisting ? keepExistingValue : mergeValue;
}

/** Merge a structured property paste atomically, retaining unrelated YAML bytes. */
export function mergeProperties(
  source: string,
  incoming: Record<string, unknown>,
  options?: MergeOptions,
): PropertyChange[] | undefined {
  const merge = mergerFor(options);
  try {
    const header = headerParts(source);
    const current = frontmatter(source)?.values;
    if (!header || !current || !validIncoming(incoming)) {
      return undefined;
    }
    const document = loadYaml().parseDocument(header.body, {
      uniqueKeys: true,
    });
    if (
      document.errors.length ||
      (document.contents !== null && !loadYaml().isMap(document.contents))
    ) {
      return undefined;
    }
    const expected = new Map<string, unknown>();
    const edits = new MergeEdits(source, header, document);
    for (const [key, incomingValue] of Object.entries(incoming)) {
      const value = merge(
        Object.hasOwn(current, key) ? current[key] : undefined,
        incomingValue,
      );
      expected.set(key, value);
      if (
        Object.hasOwn(current, key) &&
        valueKey(current[key]) === valueKey(value)
      ) {
        continue;
      }
      if (!edits.set(key, value)) {
        return undefined;
      }
    }
    const changes = edits.finish();
    return verifiesMergedValues(source, changes, expected, current)
      ? changes
      : undefined;
  } catch {
    return undefined;
  }
}

class MergeEdits {
  private readonly changes: PropertyChange[] = [];
  private added = "";
  constructor(
    private readonly source: string,
    private readonly header: NonNullable<ReturnType<typeof headerParts>>,
    private readonly document: Document,
  ) {}

  set(key: string, value: unknown): boolean {
    const { document, source, header } = this;
    if (loadYaml().isMap(document.contents) && document.contents.flow) {
      document.set(key, value);
      return true;
    }
    const items = loadYaml().isMap(document.contents)
      ? document.contents.items
      : [];
    const pair = items.find(
      (pair) => loadYaml().isScalar(pair.key) && pair.key.value === key,
    );
    if (!pair) {
      this.added += `${yamlKey(key)}:${valueAfterKey(value, header.eol)}${header.eol}`;
      return true;
    }
    // Appending in place changes every alias of an anchored list too; the
    // full rewrite below gives those their own copy.
    const appended =
      !anchored(pair.value) &&
      appendedListItems({
        source,
        header,
        key,
        node: pair.value,
        value,
      });
    if (appended) {
      this.changes.push(appended);
      return true;
    }
    const changes = setPropertyChanges({
      source,
      header,
      document,
      node: pair.value,
      value,
    });
    if (!changes) {
      return false;
    }
    const [primary, ...aliases] = changes;
    // Explicit replacement wins over any overlapping prior alias-preservation.
    for (let index = this.changes.length - 1; index >= 0; index--) {
      const prior = this.changes[index]!;
      if (!(prior.to <= primary!.from || prior.from >= primary!.to)) {
        this.changes.splice(index, 1);
      }
    }
    this.changes.push(primary!);
    for (const alias of aliases) {
      if (
        this.changes.some(
          (prior) => !(prior.to <= alias.from || prior.from >= alias.to),
        )
      ) {
        continue;
      }
      this.changes.push(alias);
    }
    return true;
  }

  finish(): PropertyChange[] {
    const { document, header } = this;
    if (loadYaml().isMap(document.contents) && document.contents.flow) {
      this.changes.push({
        from: header.offset,
        to: header.offset + header.body.length,
        insert: document.toString({ lineWidth: 0 }).replace(/\n/g, header.eol),
      });
    } else if (this.added) {
      const at = header.offset + header.body.length;
      this.changes.push({ from: at, to: at, insert: this.added });
    }
    return this.changes;
  }
}

/** Whether `node` carries a YAML anchor (`&name`) that aliases may point at. */
function anchored(node: unknown): boolean {
  return loadYaml().isNode(node) && Boolean(node.anchor);
}

/**
 * Whether the merged note has the expected values, and every property the
 * merge was not given still has the value it had: an edit to one key must
 * not reach another (through an alias, say).
 */
function verifiesMergedValues(
  source: string,
  changes: PropertyChange[],
  expected: Map<string, unknown>,
  before: Record<string, unknown>,
): boolean {
  let candidate = source;
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    candidate =
      candidate.slice(0, change.from) +
      change.insert +
      candidate.slice(change.to);
  }
  const result = frontmatter(candidate)?.values;
  if (
    !result ||
    [...expected].some(([key, value]) => !sameWritten(result[key], value))
  ) {
    return false;
  }
  return Object.keys(before).every(
    (key) =>
      expected.has(key) || valueKey(result[key]) === valueKey(before[key]),
  );
}

function validIncoming(incoming: unknown): incoming is Record<string, unknown> {
  return (
    propertyObject(incoming) &&
    clipboardValue(incoming) &&
    Object.keys(incoming).every(validPropertyName)
  );
}
