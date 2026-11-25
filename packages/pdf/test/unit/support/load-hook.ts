import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as l10n from "@workshop/l10n";

/**
 * Run `src/webview/<file>` as written, with each import replaced by
 * `modules[specifier]` and the given globals (`document`, animation frames…),
 * so a viewer hook is exercised without React or a browser. An import that is
 * not listed fails the test instead of loading something real, except the
 * translator (`@workshop/l10n`): it is pure, and says the English text here.
 */
export function loadHook(
  file: string,
  modules: Record<string, unknown>,
  globals: Record<string, unknown> = {},
): Record<string, unknown> {
  const source = readFileSync(
    new URL(`../../../src/webview/${file}`, import.meta.url),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const evaluate = runInNewContext(
    `(function(require, module, exports) { ${output}\n})`,
    globals,
  ) as (
    require: (id: string) => unknown,
    module: { exports: Record<string, unknown> },
    exports: Record<string, unknown>,
  ) => void;
  evaluate(
    (id) => {
      if (id === "@workshop/l10n") {
        return l10n;
      }
      assert.ok(id in modules, `Unexpected runtime dependency: ${id}`);
      return modules[id];
    },
    module,
    module.exports,
  );
  return module.exports;
}
