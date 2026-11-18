import type { Scalar } from "yaml";
import { headerParts } from "./header-parts";
import { loadYaml } from "./load-yaml";
import { setPropertyChange, type PropertyChange } from "./yaml-value";

/**
 * Offer every string a top-level property holds, as its value or as an item
 * of its list, to `replace`, in reading order; each one it gives new text for
 * is rewritten where it stands. Quoting, comments, list style and everything
 * else in the header stay as they were.
 *
 * Strings YAML cannot rewrite in place are not offered: block scalars,
 * anchors, tags and aliases (an anchored value may be shared with another
 * property), and anything nested below the top level.
 */
export function mapPropertyStrings(
  source: string,
  replace: (value: string) => string | undefined,
): PropertyChange[] {
  const header = headerParts(source);
  if (!header) {
    return [];
  }
  const yaml = loadYaml();
  const document = yaml.parseDocument(header.body, { uniqueKeys: true });
  if (document.errors.length || !yaml.isMap(document.contents)) {
    return [];
  }
  const changes: PropertyChange[] = [];
  for (const pair of document.contents.items) {
    for (const node of plainStrings(pair.value)) {
      const text = replace(node.value);
      const change =
        text === undefined
          ? undefined
          : setPropertyChange(source, header, node, text);
      if (change) {
        changes.push(change);
      }
    }
  }
  return changes;
}

/** A property's string, or the strings of its list, that can be replaced where they stand. */
function plainStrings(value: unknown): Scalar<string>[] {
  const yaml = loadYaml();
  if (yaml.isSeq(value) && (value.anchor || value.tag)) {
    return [];
  }
  const nodes: unknown[] = yaml.isSeq(value) ? value.items : [value];
  return nodes.filter(
    (node): node is Scalar<string> =>
      yaml.isScalar(node) &&
      typeof node.value === "string" &&
      !node.anchor &&
      !node.tag &&
      !/BLOCK/.test(node.type ?? "") &&
      Boolean(node.range),
  );
}
