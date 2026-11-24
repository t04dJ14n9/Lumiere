import assert from "node:assert/strict";
import { test } from "node:test";
import { withoutParentVsCode } from "../vscode/parent-environment";

test("the test VS Code inherits nothing of a VS Code the tests run inside, so `code --install-extension` cannot reach it", () => {
  const inherited = withoutParentVsCode({
    PATH: "/usr/bin",
    HOME: "/home/reader",
    VSCODE_IPC_HOOK_CLI: "/run/user/1000/vscode-ipc-1.sock",
    VSCODE_GIT_IPC_HANDLE: "/run/user/1000/vscode-git-1.sock",
    VSCODE_INJECTION: "1",
    TERM_PROGRAM: "vscode",
  });
  assert.deepEqual(inherited, {
    PATH: "/usr/bin",
    HOME: "/home/reader",
    TERM_PROGRAM: "vscode",
  });
});
