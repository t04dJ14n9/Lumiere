/**
 * Drop from `require`'s cache every module whose path contains one of
 * `fragments` (written with "/"), so that the next `require` loads it again,
 * against the test's own `vscode` fake. The cache is keyed by native paths,
 * which on Windows use "\".
 */
export function forgetModules(
  require: NodeJS.Require,
  ...fragments: string[]
): void {
  for (const id of Object.keys(require.cache)) {
    const path = id.replaceAll("\\", "/");
    if (fragments.some((fragment) => path.includes(fragment))) {
      delete require.cache[id];
    }
  }
}
