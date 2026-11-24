/**
 * The environment the test VS Code inherits, without the variables of a VS
 * Code the tests themselves run inside (an integrated terminal, a Remote-SSH
 * session). Shared by the Markdown (test/vscode) and PDF
 * (packages/pdf/test/vscode) harnesses.
 *
 * `VSCODE_IPC_HOOK_CLI` matters most: with it, the `code` CLI hands
 * `--install-extension` to the VS Code that owns the terminal, which then
 * installs the test builds into the owner's own extensions and ignores
 * `--extensions-dir`. The other `VSCODE_*` variables (IPC handles, the
 * terminal's injection settings) likewise belong to that VS Code; the test
 * build needs none of them.
 */
export function withoutParentVsCode(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(environment)) {
    if (!name.startsWith("VSCODE_")) {
      clean[name] = value;
    }
  }
  return clean;
}
