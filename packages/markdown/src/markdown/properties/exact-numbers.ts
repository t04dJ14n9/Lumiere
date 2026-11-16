import { loadYaml } from "./load-yaml";

/**
 * Whether YAML `text` holds an integer a JavaScript number cannot hold
 * exactly (past ±2^53). Property values are read as numbers, so such a value
 * written back would be rounded: 18446744073709551615 becomes
 * 18446744073709552000.
 */
export function hasInexactInteger(text: string): boolean {
  const { parseDocument, visit } = loadYaml();
  let inexact = false;
  visit(parseDocument(text, { intAsBigInt: true }), {
    Scalar(_key, node) {
      if (
        typeof node.value === "bigint" &&
        !Number.isSafeInteger(Number(node.value))
      ) {
        inexact = true;
        return visit.BREAK;
      }
      return undefined;
    },
  });
  return inexact;
}
