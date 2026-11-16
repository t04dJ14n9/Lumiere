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
  return opening + yaml + closing + body;
}

function hasValidProperties(header: string): boolean {
  return frontmatter(header)?.values !== undefined;
}

/**
 * The YAML with its variables filled in inside the values that hold them,
 * as the YAML library writes those values (quoted when they need it), or
 * `undefined` when the YAML is not valid with the variables left out.
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
  const { parseDocument, visit } = loadYaml();
  const document = parseDocument(marked, { uniqueKeys: true });
  if (document.errors.length > 0) {
    return undefined;
  }
  visit(document, {
    Scalar(_key, node) {
      if (typeof node.value === "string") {
        node.value = node.value.replace(PLACEHOLDER, (_match, index: string) =>
          expand(written[Number(index)]!),
        );
      }
    },
  });
  const result = document.toString({ lineWidth: 0 });
  return yaml.endsWith("\n") ? result : result.replace(/\n$/, "");
}
