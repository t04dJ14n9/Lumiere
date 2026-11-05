import type { Document } from "yaml";
import { loadYaml } from "./load-yaml";
import type { PropertyKind } from "./types";
export type PropertyScalar = string | number | boolean | null;
/** Scalars, scalar lists, and nested YAML maps/lists that Properties can set. */
export type PropertyValue =
  | PropertyScalar
  | readonly PropertyValue[]
  | { readonly [key: string]: PropertyValue };

export function propertyInput(
  kind: PropertyKind,
  text: string,
): PropertyScalar | undefined {
  if (kind === "text") {
    // As Obsidian does: trailing spaces go, leading ones stay.
    return text.trimEnd();
  }
  if (!text.trim()) {
    return null;
  }
  if (kind === "number") {
    return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim()) &&
      Number.isFinite(Number(text))
      ? Number(text)
      : undefined;
  }
  if (kind === "date" || kind === "datetime") {
    const pattern =
      kind === "date"
        ? /^\d{4}-\d{2}-\d{2}$/
        : /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
    if (!pattern.test(text)) {
      return undefined;
    }
    const date = new Date(text.slice(0, 10) + "T00:00:00Z");
    return Number.isFinite(date.valueOf()) &&
      date.toISOString().slice(0, 10) === text.slice(0, 10)
      ? text
      : undefined;
  }
  return undefined;
}

/** True when distinct YAML keys would collapse to one JS property name. */
function hasCollidingJsKeys(node: unknown): boolean {
  const { isSeq, isMap, isScalar } = loadYaml();
  if (isSeq(node)) {
    return node.items.some((item) => hasCollidingJsKeys(item));
  }
  if (!isMap(node)) {
    return false;
  }
  const seen = new Set<string>();
  for (const pair of node.items) {
    if (
      !isScalar(pair.key) ||
      pair.key.value === undefined ||
      pair.key.value === null
    ) {
      return true;
    }
    const jsKey = String(pair.key.toJSON());
    if (seen.has(jsKey)) {
      return true;
    }
    seen.add(jsKey);
    if (hasCollidingJsKeys(pair.value)) {
      return true;
    }
  }
  return false;
}

/** Inspect tags before conversion: !!pairs becomes an ordinary JS array. */
export function settablePropertyNode(
  node: unknown,
  document?: Document,
  seen = new Set<unknown>(),
): boolean {
  const { visit, isScalar, isAlias } = loadYaml();
  if (seen.has(node)) {
    return true;
  }
  seen.add(node);
  let settable = true;
  visit(node as never, {
    Node(_key, child) {
      if (
        child.tag &&
        (!isScalar(child) ||
          !/^tag:yaml.org,2002:(?:str|int|float|bool|null|timestamp)$/.test(
            child.tag,
          ))
      ) {
        settable = false;
        return visit.BREAK;
      }
      if (
        isAlias(child) &&
        document &&
        !settablePropertyNode(child.resolve(document), document, seen)
      ) {
        settable = false;
        return visit.BREAK;
      }
      return undefined;
    },
  });
  return settable;
}

/** Parse a Properties YAML draft into a settable value, or undefined if invalid. */
export function propertyYamlInput(text: string): PropertyValue | undefined {
  if (!/[\S\u00A0]/.test(text)) {
    return null;
  }
  try {
    const { parseDocument } = loadYaml();
    const document = parseDocument(text, { uniqueKeys: true });
    if (document.errors.length) {
      return undefined;
    }
    if (
      !settablePropertyNode(document.contents, document) ||
      hasCollidingJsKeys(document.contents)
    ) {
      return undefined;
    }
    const value: unknown = plainDocumentDates(document);
    return settablePropertyValue(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function settablePropertyValue(
  value: unknown,
  ancestors = new Set<object>(),
): value is PropertyValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (value instanceof Date && Number.isFinite(value.valueOf()))
  ) {
    return true;
  }
  if (
    !value ||
    typeof value !== "object" ||
    ancestors.has(value) ||
    value instanceof Map ||
    value instanceof Set
  ) {
    return false;
  }
  ancestors.add(value);
  const ok = Array.isArray(value)
    ? value.every((item) => settablePropertyValue(item, ancestors))
    : Object.values(value).every((item) =>
        settablePropertyValue(item, ancestors),
      );
  ancestors.delete(value);
  return ok;
}

export function matchesPropertyKind(
  kind: PropertyKind,
  value: unknown,
): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  switch (kind) {
    case "text":
      return typeof value === "string";
    case "list":
    case "tags":
    case "aliases":
      return typeof value === "string" || Array.isArray(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "checkbox":
      return typeof value === "boolean";
    case "date":
    case "datetime":
      return (
        (typeof value === "string" &&
          propertyInput(kind, value) !== undefined) ||
        (value instanceof Date &&
          propertyInput(kind, propertyDateText(value)) !== undefined)
      );
  }
}

/**
 * Obsidian plain date/datetime text from a YAML timestamp scalar's source.
 * Keeps civil wall-clock digits; strips offset/Z and zero seconds.
 */
export function obsidianDateTextFromYamlSource(
  source: string,
): string | undefined {
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:[Tt](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(
      source.trim(),
    );
  if (!match) {
    return undefined;
  }
  const [, date, hm, sec] = match;
  if (!hm) {
    return date;
  }
  // Match propertyInput / prior toISOString path: drop zero seconds.
  return !sec || sec === "00" ? `${date}T${hm}` : `${date}T${hm}:${sec}`;
}

/** Obsidian-stable YAML/date-input text for a JS Date from !!timestamp. */
export function propertyDateText(value: Date, source?: string): string {
  if (!Number.isFinite(value.valueOf())) {
    return "";
  }
  if (typeof source === "string") {
    const fromSource = obsidianDateTextFromYamlSource(source);
    if (fromSource !== undefined) {
      return fromSource;
    }
  }
  const iso = value.toISOString();
  // YAML !!timestamp date-only values parse as UTC midnight.
  if (iso.endsWith("T00:00:00.000Z")) {
    return iso.slice(0, 10);
  }
  // Match inferPropertyKind / propertyInput: drop zero seconds.
  return iso.endsWith(":00.000Z") ? iso.slice(0, 16) : iso.slice(0, 19);
}

/**
 * Replace !!timestamp Dates using each scalar's YAML source (wall-clock),
 * then toJS. Restores Date values afterward so the document stays editable.
 */
export function plainDocumentDates(document: Document): unknown {
  const { visit } = loadYaml();
  const restored: { node: { value: unknown }; prior: Date }[] = [];
  visit(document, {
    Scalar(_key, node) {
      if (node.value instanceof Date && Number.isFinite(node.value.valueOf())) {
        restored.push({ node, prior: node.value });
        node.value = propertyDateText(
          node.value,
          typeof node.source === "string" ? node.source : undefined,
        );
      }
    },
  });
  try {
    return document.toJS({ maxAliasCount: 100 });
  } finally {
    for (const { node, prior } of restored) {
      node.value = prior;
    }
  }
}

/** Walk a parsed YAML value and replace Dates with plain date strings. */
export function plainPropertyDates(value: unknown): unknown {
  if (value instanceof Date) {
    return propertyDateText(value);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(plainPropertyDates);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, plainPropertyDates(item)]),
  );
}
