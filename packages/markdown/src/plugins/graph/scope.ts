/** A graph draws every note in one vault. */
export interface GraphScope {
  /** Stable id for the vault, echoed back by the webview when it opens a node. */
  readonly id: string;
  readonly name: string;
  readonly vaultRoot: string;
}

export type ScopeDecision =
  | { kind: "keep" }
  | { kind: "empty" }
  | { kind: "use"; scope: GraphScope }
  | { kind: "ask"; choices: readonly GraphScope[] };

/**
 * Pick a vault without guessing a workspace folder.
 * An existing scope stays put until the user asks to change it.
 */
export function selectScope(input: {
  explicit: boolean;
  hasCurrent: boolean;
  owner?: GraphScope;
  choices: readonly GraphScope[];
}): ScopeDecision {
  if (!input.explicit && input.hasCurrent) {
    return { kind: "keep" };
  }
  if (!input.explicit && input.owner) {
    return { kind: "use", scope: input.owner };
  }
  if (input.choices.length === 0) {
    return { kind: "empty" };
  }
  if (!input.explicit && input.choices.length === 1) {
    const scope = input.choices[0];
    if (scope) {
      return { kind: "use", scope };
    }
  }
  return { kind: "ask", choices: input.choices };
}
