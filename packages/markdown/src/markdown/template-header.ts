import { frontmatter, headerParts } from "./properties/frontmatter";
import { loadYaml } from "./properties/load-yaml";

/** Fills in the variables of a piece of a template. */
type Expand = (text: string) => string;

/**
 * Stands for a variable while the template's YAML is parsed. Letters and
 * digits only, so it reads as plain text wherever the variable was written.
 */
const PLACEHOLDER = /LumiereTemplateVariable(\d+)End/g;

/**
 * A template's text with its variables filled in. The properties block is
 * filled in as written when that gives valid YAML. When it does not (a
 * title such as `[draft] plan` in `title: {{title}}` reads as a list), each
 * value holding a variable is written quoted instead, so the block stays
 * properties. A block whose YAML is broken before any variable is filled
 * in is left as the plain expansion gives it, for the caller to report.
 */
export function expandWithProperties(
  template: string,
  variables: RegExp,
  expand: Expand,
): string {
  const header = headerParts(template);
  if (!header) {
    return expand(template);
  }
  const body = expand(template.slice(header.end));
  const plain = expand(template.slice(0, header.end));
  if (hasValidProperties(plain)) {
    return plain + body;
  }
  const yaml = quotedValues(header.body, variables, expand);
  if (yaml === undefined) {
    return plain + body;
  }
  const opening = template.slice(0, header.offset);
  const closing = template.slice(
    header.offset + header.body.length,
    header.end,
  );
  const quoted = opening + yaml + closing;
  return (hasValidProperties(quoted) ? quoted : plain) + body;
}

function hasValidProperties(header: string): boolean {
  return frontmatter(header)?.values !== undefined;
}

/**
 * The YAML with its variables filled in, each value that holds one written
 * quoted, or `undefined` when the YAML is not valid with the variables left
 * out. Only those values are rewritten, in place: every other byte (a long
 * integer, a comment, the layout) stays as the template has it.
 */
function quotedValues(
  yaml: string,
  variables: RegExp,
  expand: Expand,
): string | undefined {
  const written: string[] = [];
  const marked = yaml.replace(variables, (variable) => {
    written.push(variable);
    return `LumiereTemplateVariable${written.length - 1}End`;
  });
  const fill = (text: string) =>
    text.replace(PLACEHOLDER, (_match, index: string) =>
      expand(written[Number(index)]!),
    );
  const { parseDocument, visit } = loadYaml();
  const document = parseDocument(marked, { uniqueKeys: true });
  if (document.errors.length > 0) {
    return undefined;
  }
  const ranges: { from: number; to: number; insert: string }[] = [];
  visit(document, {
    Scalar(_key, node) {
      if (
        typeof node.value === "string" &&
        node.range &&
        node.value.search(PLACEHOLDER) >= 0
      ) {
        // A YAML double-quoted scalar reads a JSON string as written. A
        // block scalar's range takes in its line break (and any blank lines
        // after it): those stay, or the next line would run on from it.
        const original = marked.slice(node.range[0], node.range[1]);
        ranges.push({
          from: node.range[0],
          to: node.range[1],
          insert:
            JSON.stringify(fill(node.value)) +
            original.slice(original.trimEnd().length),
        });
      }
    },
  });
  let result = marked;
  for (const range of ranges.sort((a, b) => b.from - a.from)) {
    result =
      result.slice(0, range.from) + range.insert + result.slice(range.to);
  }
  // What is left (a variable in a comment) is filled in as written.
  result = fill(result);
  return parseDocument(result, { uniqueKeys: true }).errors.length > 0
    ? undefined
    : result;
}
