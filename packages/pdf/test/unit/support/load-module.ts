import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

/**
 * Run one source module with each of its imports replaced by
 * `modules[specifier]`, so a module that imports VS Code or its siblings is
 * exercised as written, against controlled stand-ins. An import that is not
 * listed fails the test instead of loading something real.
 */
export function loadModule(
  source: URL,
  modules: Record<string, unknown>,
): Record<string, unknown> {
  const output = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const evaluate = runInNewContext(
    `(function(require, module, exports) { ${output}\n})`,
  ) as (
    require: (id: string) => unknown,
    module: { exports: Record<string, unknown> },
    exports: Record<string, unknown>,
  ) => void;
  evaluate(
    (id) => {
      assert.ok(id in modules, `Unexpected runtime dependency: ${id}`);
      return modules[id];
    },
    module,
    module.exports,
  );
  return module.exports;
}
