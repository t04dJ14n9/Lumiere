import type { Document, Pair } from "yaml";
import { loadYaml } from "./load-yaml";
import { headerParts, frontmatter } from "./frontmatter";
import { orderPropertyBody } from "./order";
import { validPropertyName } from "./types";
import type { PropertyValue } from "./values";
import { propertyYamlInput, settablePropertyValue } from "./values";
import { mergeProperties } from "./merge";
import { setPropertyChanges } from "./alias-edits";
import {
  yamlValue,
  yamlKey,
  scalarValue,
  setPropertyChange,
  valueAfterKey,
  sameWritten,
  type PropertyChange,
} from "./yaml-value";

export type { PropertyChange };
export { yamlValue, yamlKey, scalarValue, setPropertyChange };

export type PropertyEdit =
  | { type: "order"; keys: readonly string[] }
  | { type: "merge"; values: Record<string, unknown> }
  | {
      type: "set";
      key: string;
      value: PropertyValue;
      /** When supplied, this text is the write source; value only validates it. */
      yaml?: string | undefined;
    }
  | { type: "add"; key: string; value?: PropertyValue }
  | { type: "rename"; key: string; name: string }
  | { type: "remove"; keys: readonly string[] };

type Header = NonNullable<ReturnType<typeof headerParts>>;

const propertyValue = (value: unknown): value is PropertyValue =>
  settablePropertyValue(value);

type KeyEdit = Exclude<PropertyEdit, { type: "order" | "merge" }>;

/** Structural edits touch selected keys/values, preserving unrelated YAML bytes. */
export function propertyChanges(
  source: string,
  edit: PropertyEdit,
): PropertyChange[] | undefined {
  if (edit.type === "order") {
    return reorderProperties(source, edit.keys);
  }
  if (edit.type === "merge") {
    return mergeProperties(source, edit.values);
  }
  if (!validKeyEdit(edit)) {
    return undefined;
  }
  const header = headerParts(source);
  if (!header) {
    return createHeader(source, edit);
  }
  const document = loadYaml().parseDocument(header.body, { uniqueKeys: true });
  if (
    document.errors.length ||
    (document.contents !== null && !loadYaml().isMap(document.contents))
  ) {
    return undefined;
  }
  const changes = new PropertyMapEdits(header, document).changes(source, edit);
  return changes && verifyChanges(source, edit, changes);
}

function reorderProperties(
  source: string,
  keys: readonly string[],
): PropertyChange[] | undefined {
  const header = headerParts(source);
  const ordered = header && orderPropertyBody(header.body, keys, header.eol);
  return header && ordered !== undefined
    ? [
        {
          from: header.offset,
          to: header.offset + header.body.length,
          insert: ordered,
        },
      ]
    : undefined;
}

function validKeyEdit(edit: KeyEdit): boolean {
  if (edit.type !== "remove" && !validPropertyName(edit.key)) {
    return false;
  }
  if (edit.type === "rename" && !validPropertyName(edit.name)) {
    return false;
  }
  if (edit.type === "set") {
    return (
      propertyValue(edit.value) &&
      (edit.yaml === undefined ||
        stableEqual(propertyYamlInput(edit.yaml), edit.value))
    );
  }
  return (
    edit.type !== "add" || edit.value === undefined || propertyValue(edit.value)
  );
}

function createHeader(
  source: string,
  edit: KeyEdit,
): PropertyChange[] | undefined {
  if (edit.type !== "add" || /^\uFEFF?---(?:\r?\n|$)/.test(source)) {
    return undefined;
  }
  // As Obsidian writes it: the new header right before the note's text, and
  // after a byte order mark, which must stay the first character.
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const at = source.startsWith("\uFEFF") ? 1 : 0;
  return [
    {
      from: at,
      to: at,
      insert: `---${eol}${newPropertyLine(edit, eol)}${eol}---${eol}`,
    },
  ];
}

class PropertyMapEdits {
  constructor(
    private readonly header: Header,
    private readonly document: Document,
  ) {}

  private get items() {
    return loadYaml().isMap(this.document.contents)
      ? this.document.contents.items
      : [];
  }

  changes(source: string, edit: KeyEdit): PropertyChange[] | undefined {
    switch (edit.type) {
      case "add":
        return this.add(edit);
      case "rename":
        return this.rename(edit);
      case "remove":
        return this.remove(source, edit.keys);
      case "set": {
        const pair = this.items.find(
          (pair) =>
            loadYaml().isScalar(pair.key) && pair.key.value === edit.key,
        );
        return setPropertyChanges({
          source,
          header: this.header,
          document: this.document,
          node: pair?.value,
          value: edit.value,
          yaml: edit.yaml,
        });
      }
    }
  }

  private wholeMap(): PropertyChange[] {
    const { header, document } = this;
    return [
      {
        from: header.offset,
        to: header.offset + header.body.length,
        insert: document.toString({ lineWidth: 0 }).replace(/\n/g, header.eol),
      },
    ];
  }

  private add(
    edit: Extract<KeyEdit, { type: "add" }>,
  ): PropertyChange[] | undefined {
    if (this.document.has(edit.key)) {
      return undefined;
    }
    if (
      loadYaml().isMap(this.document.contents) &&
      this.document.contents.flow
    ) {
      this.document.set(edit.key, edit.value ?? null);
      return this.wholeMap();
    }
    const end = this.header.offset + this.header.body.length;
    return [
      {
        from: end,
        to: end,
        insert: `${newPropertyLine(edit, this.header.eol)}${this.header.eol}`,
      },
    ];
  }

  private rename(
    edit: Extract<KeyEdit, { type: "rename" }>,
  ): PropertyChange[] | undefined {
    const pair = this.items.find(
      (pair) => loadYaml().isScalar(pair.key) && pair.key.value === edit.key,
    );
    if (
      !pair ||
      !loadYaml().isScalar(pair.key) ||
      !pair.key.range ||
      (edit.key !== edit.name && this.document.has(edit.name))
    ) {
      return undefined;
    }
    return [
      {
        from: this.header.offset + pair.key.range[0],
        to: this.header.offset + pair.key.range[1],
        insert: yamlKey(edit.name),
      },
    ];
  }

  private remove(
    source: string,
    keys: readonly string[],
  ): PropertyChange[] | undefined {
    // Every key counts, not only the strings: a note with `1: a` has a property
    // named "1" that the fence must outlive, and that can itself be removed.
    const stored = this.items.flatMap((item) => keyName(item.key) ?? []);
    if (keys.some((key) => !validPropertyName(key) || !stored.includes(key))) {
      return undefined;
    }
    // Obsidian drops the empty `---` fence when the last property is removed
    // (BH-013); leaving `---\n---` would count as body and inflate stats.
    if (stored.length > 0 && stored.every((key) => keys.includes(key))) {
      return dropFrontmatterFence(source, this.header);
    }
    const map = this.document.contents;
    if (loadYaml().isMap(map) && map.flow) {
      // Not document.delete(key): it matches a key's type, so "1" misses `1`.
      map.items = map.items.filter((item) => {
        const name = keyName(item.key);
        return name === undefined || !keys.includes(name);
      });
      return this.wholeMap();
    }
    return this.items.flatMap((item) => {
      const name = keyName(item.key);
      if (
        name === undefined ||
        !keys.includes(name) ||
        !loadYaml().isScalar(item.key) ||
        !item.key.range
      ) {
        return [];
      }
      const start =
        this.header.body.lastIndexOf("\n", item.key.range[0] - 1) + 1;
      let end = entryEnd(this.header.body, item, item.key.range[2]);
      if (this.header.body[end] === "\r") {
        end++;
      }
      if (this.header.body[end] === "\n") {
        end++;
      }
      return [
        {
          from: this.header.offset + start,
          to: this.header.offset + end,
          insert: "",
        },
      ];
    });
  }
}

/**
 * Where a removed entry's own text ends. yaml stretches an empty value (`a:`)
 * over the comment lines after it, which belong to the next entry, so such a
 * value ends with its line.
 */
function entryEnd(body: string, item: Pair, keyEnd: number): number {
  const { isNode, isScalar } = loadYaml();
  const value: unknown = item.value;
  if (!isNode(value) || !value.range) {
    return keyEnd;
  }
  if (!isScalar(value) || value.range[0] !== value.range[1]) {
    return value.range[2];
  }
  const lineEnd = body.indexOf("\n", value.range[1]);
  return lineEnd < 0 ? body.length : lineEnd;
}

/**
 * The property name a plain scalar key reads back as: `1: a` is "1", and a null
 * key is "", as the sheet names it, so it is not the string key "null".
 */
function keyName(key: unknown): string | undefined {
  if (!loadYaml().isScalar(key)) {
    return undefined;
  }
  const { value } = key;
  if (value === null) {
    return "";
  }
  return ["string", "number", "boolean"].includes(typeof value)
    ? String(value)
    : undefined;
}

/**
 * Remove the opening fence, body and closing fence, leaving a byte order mark.
 * When the note's own text opens with a `---` block, a blank line takes the
 * fence's place: at the top of the note that block would be read as the
 * properties.
 */
function dropFrontmatterFence(
  source: string,
  header: Header,
): PropertyChange[] {
  const rest = source.slice(0, header.start) + source.slice(header.end);
  return [
    {
      from: header.start,
      to: header.end,
      insert: headerParts(rest) ? header.eol : "",
    },
  ];
}

function newPropertyLine(
  edit: Extract<KeyEdit, { type: "add" }>,
  eol: string,
): string {
  return edit.value === undefined || edit.value === null
    ? `${yamlKey(edit.key)}:`
    : `${yamlKey(edit.key)}:${valueAfterKey(edit.value, eol)}`;
}

function stableEqual(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, object>(),
): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }
  if (seen.get(left) === right) {
    return true;
  }
  seen.set(left, right);
  const leftEntries = Array.isArray(left)
    ? left.map((value, index) => [String(index), value] as const)
    : Object.entries(left);
  const rightEntries = Array.isArray(right)
    ? right.map((value, index) => [String(index), value] as const)
    : Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  const rightMap = new Map(rightEntries);
  return leftEntries.every(
    ([key, value]) =>
      rightMap.has(key) && stableEqual(value, rightMap.get(key), seen),
  );
}

function applyChanges(source: string, changes: PropertyChange[]): string {
  let candidate = source;
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    candidate =
      candidate.slice(0, change.from) +
      change.insert +
      candidate.slice(change.to);
  }
  return candidate;
}

function editTouchesKey(edit: KeyEdit, key: string): boolean {
  return (
    (edit.type === "set" && key === edit.key) ||
    (edit.type === "remove" && edit.keys.includes(key)) ||
    (edit.type === "rename" && key === edit.key)
  );
}

function verifyChanges(
  source: string,
  edit: KeyEdit,
  changes: PropertyChange[],
): PropertyChange[] | undefined {
  try {
    const before = frontmatter(source)?.values;
    if (!before) {
      return undefined;
    }
    const result = applyChanges(source, changes);
    const checked = frontmatter(result);
    const after = checked?.values;
    // Last property removed: the empty fence is gone, so there is no header.
    if (
      edit.type === "remove" &&
      after === undefined &&
      checked === undefined
    ) {
      return Object.keys(before).every((key) => edit.keys.includes(key))
        ? changes
        : undefined;
    }
    if (!after || checked?.error) {
      return undefined;
    }
    if (edit.type === "set" && !sameWritten(after[edit.key], edit.value)) {
      return undefined;
    }
    const stable = Object.entries(before).every(
      ([key, value]) =>
        editTouchesKey(edit, key) || stableEqual(after[key], value),
    );
    return stable ? changes : undefined;
  } catch {
    return undefined;
  }
}
