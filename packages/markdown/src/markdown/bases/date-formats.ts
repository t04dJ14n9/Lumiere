import { unsupportedMomentTokens } from "../moment-format";
import { parseExpr, type ExprNode } from "./ast";
import type { BaseDefinition, BaseFilter } from "./types";

/**
 * The Moment tokens a base's `format("…")` calls use that Lumiere cannot
 * write, as Insert Template reports them for a template's dates. Only
 * patterns written as text in the base are checked; one computed from a
 * property is known only per note.
 */
export function unsupportedBaseDateTokens(
  definition: BaseDefinition,
): string[] {
  const tokens = new Set<string>();
  for (const expression of baseExpressions(definition)) {
    for (const pattern of formatPatterns(safeParse(expression))) {
      unsupportedMomentTokens(pattern).forEach((token) => tokens.add(token));
    }
  }
  return [...tokens];
}

function baseExpressions(definition: BaseDefinition): string[] {
  return [
    ...Object.values(definition.formulas),
    ...filterExpressions(definition.filters),
    ...definition.views.flatMap((view) => filterExpressions(view.filters)),
  ];
}

function filterExpressions(filter: BaseFilter | undefined): string[] {
  if (!filter) {
    return [];
  }
  return filter.kind === "expr"
    ? [filter.expr]
    : filter.items.flatMap(filterExpressions);
}

function safeParse(expression: string): ExprNode | undefined {
  try {
    return parseExpr(expression);
  } catch {
    return undefined;
  }
}

/** The literal patterns of the `.format(…)` calls in an expression. */
function formatPatterns(node: ExprNode | undefined): string[] {
  if (!node) {
    return [];
  }
  switch (node.kind) {
    case "call": {
      const pattern = node.args[0];
      const own =
        node.callee.kind === "member" &&
        node.callee.property === "format" &&
        pattern?.kind === "literal" &&
        typeof pattern.value === "string"
          ? [pattern.value]
          : [];
      return [
        ...own,
        ...formatPatterns(node.callee),
        ...node.args.flatMap(formatPatterns),
      ];
    }
    case "member":
      return formatPatterns(node.object);
    case "index":
      return [...formatPatterns(node.object), ...formatPatterns(node.index)];
    case "binary":
      return [...formatPatterns(node.left), ...formatPatterns(node.right)];
    case "unary":
      return formatPatterns(node.arg);
    case "list":
      return node.items.flatMap(formatPatterns);
    default:
      return [];
  }
}

/** What a base embed says about the tokens `unsupportedBaseDateTokens` found. */
export function unsupportedDateTokensMessage(
  tokens: readonly string[],
): string {
  const verb = tokens.length === 1 ? "it is" : "they are";
  return `This base's date format uses ${tokens.join(", ")}, which Lumiere cannot format yet; ${verb} shown as written.`;
}
