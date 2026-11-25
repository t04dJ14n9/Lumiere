import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as l10n from "@workshop/l10n";
import * as locations from "../../src/shared/pdf-location";
import * as placement from "../../src/shared/open-placement";
import * as targets from "../../src/shared/pdf-target-resolution";
import { OPEN_LOCATION_COMMAND_ID } from "../../src/shared/command-ids";
import { formatPdfDeepLink } from "../../src/shared/text-fragment";

class Uri {
  readonly path: string;
  readonly fragment: string;
  constructor(file: string, fragment = "") {
    this.path = file;
    this.fragment = fragment;
  }
  static file(file: string): Uri {
    return new Uri(file);
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(path.join(base.path, ...parts));
  }
  static parse(value: string): Uri {
    const url = new URL(value);
    // Decode %23 etc. so fsPath matches the real file (VS Code Uri does this).
    return new Uri(decodeURIComponent(url.pathname), url.hash.slice(1));
  }
  get fsPath(): string {
    return this.path;
  }
  with(change: { fragment: string }): Uri {
    return new Uri(this.path, change.fragment);
  }
  toString(): string {
    const encoded = this.path.replaceAll("#", "%23").replaceAll("?", "%3F");
    return `file://${encoded}${this.fragment ? `#${this.fragment}` : ""}`;
  }
}

class Disposable {
  private callback: (() => void) | undefined;
  constructor(callback: () => void) {
    this.callback = callback;
  }
  dispose(): void {
    const callback = this.callback;
    this.callback = undefined;
    callback?.();
  }
}

class CancellationTokenSource {
  readonly token = { isCancellationRequested: false };
  cancel(): void {
    this.token.isCancellationRequested = true;
  }
  dispose(): void {
    /* No platform resources in this controlled fake. */
  }
}

interface OpenRequest {
  file: string;
  /** What followed the view type: a column, or show options. */
  placement: unknown[];
  resolve(): void;
  reject(error: Error): void;
}

/** An editor that has a PDF open already, as the panels hand it to the command. */
interface OpenEditorSpec {
  label: string;
  file: string;
  viewColumn: number;
  visible: boolean;
}

/** Actual command module; only the VS Code transport is replaced with controlled promises. */
function harness(
  isFile: (file: string) => boolean = () => true,
  scene: { editors?: OpenEditorSpec[]; activeColumn?: number } = {},
) {
  let invoke:
    | ((
        target?: unknown,
        location?: unknown,
        options?: unknown,
      ) => Promise<boolean>)
    | undefined;
  const opened: OpenRequest[] = [];
  const jumps: { file: string; page: number }[] = [];
  /** Which editor each jump went to, and each reveal asked of an open editor. */
  const jumpedEditors: string[] = [];
  const revealed: { label: string; args: unknown[] }[] = [];
  const fakeEditor = (
    label: string,
    file: string,
    viewColumn: number,
    visible: boolean,
  ) => ({
    file,
    webviewPanel: {
      viewColumn,
      visible,
      reveal: (...args: unknown[]) => void revealed.push({ label, args }),
    },
    goTo: (location: { page: number }) => {
      jumps.push({ file, page: location.page });
      jumpedEditors.push(label);
    },
  });
  const sceneEditors = (scene.editors ?? []).map((spec) =>
    fakeEditor(spec.label, spec.file, spec.viewColumn, spec.visible),
  );
  /** What `waitForNew` was told is already open. */
  const knownWhenWaiting: number[] = [];
  const warnings: string[] = [];
  const vscode = {
    Uri,
    Disposable,
    ViewColumn: { Beside: -2 },
    CancellationTokenSource,
    FileType: { File: 1, Directory: 2 },
    workspace: {
      workspaceFolders: [],
      fs: {
        stat: async (uri: Uri) => {
          if (!isFile(uri.path)) {
            throw new Error("FileNotFound");
          }
          return { type: 1 };
        },
      },
    },
    window: {
      tabGroups: { activeTabGroup: { viewColumn: scene.activeColumn ?? 1 } },
      showInputBox: async () => undefined,
      showQuickPick: async () => undefined,
      showWarningMessage: async (message: string) => {
        warnings.push(message);
      },
    },
    commands: {
      registerCommand: (_id: string, callback: typeof invoke) => {
        invoke = callback;
        return new Disposable(() => undefined);
      },
      executeCommand: (
        id: string,
        file: Uri,
        _viewType: string,
        ...placement: unknown[]
      ) => {
        assert.equal(id, "vscode.openWith");
        return new Promise<void>((resolve, reject) => {
          opened.push({ file: file.path, placement, resolve, reject });
        });
      },
    },
  };
  const modules: Record<string, unknown> = {
    "node:path": path,
    vscode,
    "@workshop/l10n": l10n,
    "../../../shared/open-placement": placement,
    "../../../shared/pdf-location": locations,
    "../../../shared/pdf-target-resolution": targets,
    "./panels": { VIEW_TYPE: "lumiere.pdf.viewer" },
    "../../../shared/command-ids": { OPEN_LOCATION_COMMAND_ID },
  };
  const source = readFileSync(
    new URL("../../src/extension/plugins/pdf/commands.ts", import.meta.url),
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
  const register = module.exports.registerOpenLocation as (
    panels: unknown,
  ) => Disposable;
  const registration = register({
    waitFor: async (file: Uri) => ({
      file,
      goTo: (location: { page: number }) => {
        jumps.push({ file: file.path, page: location.page });
      },
    }),
    editorsOf: (file: Uri) =>
      sceneEditors.filter((editor) => editor.file === file.path),
    // The editor the open made: in the group the open asked for.
    waitForNew: async (file: Uri, known: Set<unknown>) => {
      knownWhenWaiting.push(known.size);
      return fakeEditor("new", file.path, 2, true);
    },
  });
  return {
    opened,
    jumps,
    jumpedEditors,
    revealed,
    knownWhenWaiting,
    warnings,
    registration,
    invoke: (file: string, page = 2) => invoke!(file, { page }),
    /** Open from a single durable link; page/box come from the URI fragment. */
    invokeLink: (link: string) => invoke!(link),
    /** Open with the command's third argument, as a note's link or the agent bridge does. */
    invokeWith: (file: string, options: unknown) =>
      invoke!(file, { page: 2 }, options),
  };
}

async function microtasks(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
}

test("a slow open A cannot overtake newer C, and obsolete queued B never dispatches", async () => {
  const state = harness();
  const a = state.invoke("/a.pdf", 2);
  await microtasks();
  assert.deepEqual(
    state.opened.map((request) => request.file),
    ["/a.pdf"],
  );
  const b = state.invoke("/b.pdf", 3);
  const c = state.invoke("/c.pdf", 4);
  await microtasks();
  assert.deepEqual(
    state.opened.map((request) => request.file),
    ["/a.pdf"],
  );
  state.opened[0]!.resolve();
  await microtasks();
  assert.deepEqual(
    state.opened.map((request) => request.file),
    ["/a.pdf", "/c.pdf"],
  );
  state.opened[1]!.resolve();
  assert.deepEqual(await Promise.all([a, b, c]), [false, false, true]);
  assert.deepEqual(state.jumps, [{ file: "/c.pdf", page: 4 }]);
  state.registration.dispose();
});

test("disposing the command invalidates in-flight arrival and skips queued native opens", async () => {
  const state = harness();
  const a = state.invoke("/a.pdf");
  await microtasks();
  const b = state.invoke("/b.pdf");
  await microtasks();
  state.registration.dispose();
  state.opened[0]!.resolve();
  assert.deepEqual(await Promise.all([a, b]), [false, false]);
  assert.deepEqual(
    state.opened.map((request) => request.file),
    ["/a.pdf"],
  );
  assert.deepEqual(state.jumps, []);
});

test("a rejected older native open does not poison the queue for the newest request", async () => {
  const state = harness();
  const a = state.invoke("/a.pdf").catch((error: unknown) => error);
  await microtasks();
  const b = state.invoke("/b.pdf", 7);
  await microtasks();
  state.opened[0]!.reject(new Error("old editor failed"));
  await microtasks();
  assert.deepEqual(
    state.opened.map((request) => request.file),
    ["/a.pdf", "/b.pdf"],
  );
  state.opened[1]!.resolve();
  const failed = await a;
  assert.ok(failed instanceof Error);
  assert.match(failed.message, /old editor failed/);
  assert.equal(await b, true);
  assert.deepEqual(state.jumps, [{ file: "/b.pdf", page: 7 }]);
  state.registration.dispose();
});

test("a durable locator with # in the filename round-trips through openLocation", async () => {
  const state = harness();
  const link =
    "file:///work/papers/report%23draft.pdf#page=3&viewrect=10,20,20,20";
  const done = state.invokeLink(link);
  await microtasks();
  assert.deepEqual(
    state.opened.map((request) => request.file),
    ["/work/papers/report#draft.pdf"],
  );
  state.opened[0]!.resolve();
  assert.equal(await done, true);
  assert.deepEqual(state.jumps, [
    { file: "/work/papers/report#draft.pdf", page: 3 },
  ]);
  state.registration.dispose();
});

test("a fragment that names no location is refused with a warning", async () => {
  const state = harness();
  assert.equal(await state.invokeLink("file:///work/paper.pdf#nothing"), false);
  assert.match(state.warnings.at(-1) ?? "", /location is invalid/);
  state.registration.dispose();
});

test("a Copy link line for a PDF with spaces and parentheses opens that file at its page", async () => {
  const onDisk = "/work/papers/my paper (v2) 100%.pdf";
  const state = harness((file) => file === onDisk);
  const link = formatPdfDeepLink(onDisk, { page: 4, text: "a) first" });
  assert.match(link, /^\/work\/papers\/my%20paper%20%28v2%29%20100%25\.pdf#/u);
  const done = state.invokeLink(`> [my paper (v2) 100%.pdf · p.4](${link})`);
  await microtasks();
  assert.deepEqual(
    state.opened.map((request) => request.file),
    [onDisk],
  );
  state.opened[0]!.resolve();
  assert.equal(await done, true);
  assert.deepEqual(state.jumps, [{ file: onDisk, page: 4 }]);
  state.registration.dispose();
});

test("a path typed with a literal %20 in its file name still opens", async () => {
  const onDisk = "/work/a%20b.pdf";
  const state = harness((file) => file === onDisk);
  const done = state.invokeLink(`${onDisk}#page=2`);
  await microtasks();
  assert.deepEqual(
    state.opened.map((request) => request.file),
    [onDisk],
  );
  state.opened[0]!.resolve();
  assert.equal(await done, true);
  state.registration.dispose();
});

test("a Copy link quote link opens the PDF at its page, pasted bare or inside its Markdown line", async () => {
  const state = harness();
  const link = formatPdfDeepLink("file:///work/papers/attention.pdf", {
    page: 3,
    text: "Scaled dot-product attention",
  });
  for (const text of [link, `> [attention.pdf · p.3](${link})`]) {
    const done = state.invokeLink(text);
    await microtasks();
    state.opened.at(-1)!.resolve();
    assert.equal(await done, true, text);
  }
  assert.deepEqual(state.jumps, [
    { file: "/work/papers/attention.pdf", page: 3 },
    { file: "/work/papers/attention.pdf", page: 3 },
  ]);
  state.registration.dispose();
});

test("a plain open sends the editor a column or nothing, and waits for the editor the reader is in", async () => {
  const state = harness();
  const cases: [unknown, unknown[]][] = [
    [undefined, []],
    [{ viewColumn: -2 }, [-2]],
    // Not a boolean true: the focus is not kept.
    [{ preserveFocus: "yes" }, []],
  ];
  for (const [options, placement] of cases) {
    const done = state.invokeWith("/a.pdf", options);
    await microtasks();
    const request = state.opened.at(-1)!;
    // Compared as JSON: the command ran in another realm (see `harness`).
    assert.equal(
      JSON.stringify(request.placement),
      JSON.stringify(placement),
      JSON.stringify(options),
    );
    request.resolve();
    assert.equal(await done, true);
  }
  assert.deepEqual(state.revealed, []);
  assert.deepEqual(state.knownWhenWaiting, []);
  state.registration.dispose();
});

test("an agent's open of a PDF that is not open goes beside the current editor, as a tab that stays, without the focus", async () => {
  const state = harness();
  for (const [options, viewColumn] of [
    [{ preserveFocus: true }, -2],
    [{ preserveFocus: true, viewColumn: 3 }, 3],
  ] as const) {
    const done = state.invokeWith("/a.pdf", options);
    await microtasks();
    const request = state.opened.at(-1)!;
    assert.equal(
      JSON.stringify(request.placement),
      JSON.stringify([{ viewColumn, preserveFocus: true, preview: false }]),
    );
    request.resolve();
    assert.equal(await done, true);
  }
  // The page is set on the editor the open made, not on one that was there.
  assert.deepEqual(state.jumpedEditors, ["new", "new"]);
  assert.deepEqual(state.jumps, [
    { file: "/a.pdf", page: 2 },
    { file: "/a.pdf", page: 2 },
  ]);
  assert.deepEqual(state.knownWhenWaiting, [0, 0]);
  assert.deepEqual(state.revealed, []);
  state.registration.dispose();
});

test("an agent's open of a PDF open in another group shows that editor where it is: no new tab, no focus", async () => {
  const state = harness(() => true, {
    activeColumn: 1,
    editors: [
      { label: "right", file: "/a.pdf", viewColumn: 2, visible: false },
    ],
  });
  assert.equal(await state.invokeWith("/a.pdf", { preserveFocus: true }), true);
  assert.deepEqual(state.opened, []);
  // Revealed in its own group (no column), keeping the focus.
  assert.deepEqual(state.revealed, [
    { label: "right", args: [undefined, true] },
  ]);
  assert.deepEqual(state.jumpedEditors, ["right"]);
  state.registration.dispose();
});

test("an agent's open of a PDF already in view sets its page and changes nothing else", async () => {
  const state = harness(() => true, {
    activeColumn: 1,
    editors: [{ label: "front", file: "/a.pdf", viewColumn: 2, visible: true }],
  });
  assert.equal(await state.invokeWith("/a.pdf", { preserveFocus: true }), true);
  assert.deepEqual(state.opened, []);
  assert.deepEqual(state.revealed, []);
  assert.deepEqual(state.jumpedEditors, ["front"]);
  state.registration.dispose();
});

test("an agent's open of a PDF hidden behind a tab of the active group opens beside, not on top of the editor the keyboard is in", async () => {
  const state = harness(() => true, {
    activeColumn: 1,
    editors: [
      { label: "hidden", file: "/a.pdf", viewColumn: 1, visible: false },
    ],
  });
  const done = state.invokeWith("/a.pdf", { preserveFocus: true });
  await microtasks();
  const request = state.opened.at(-1)!;
  assert.equal(
    JSON.stringify(request.placement),
    JSON.stringify([{ viewColumn: -2, preserveFocus: true, preview: false }]),
  );
  request.resolve();
  assert.equal(await done, true);
  // The hidden editor is left alone, and counted as one that was there.
  assert.deepEqual(state.revealed, []);
  assert.deepEqual(state.knownWhenWaiting, [1]);
  assert.deepEqual(state.jumpedEditors, ["new"]);
  state.registration.dispose();
});

test("a human's open still goes to the active group and waits for the editor the reader is in, even when the PDF is open elsewhere", async () => {
  const state = harness(() => true, {
    editors: [{ label: "right", file: "/a.pdf", viewColumn: 2, visible: true }],
  });
  const done = state.invoke("/a.pdf", 4);
  await microtasks();
  assert.equal(state.opened.length, 1);
  assert.deepEqual(state.opened[0]!.placement, []);
  state.opened[0]!.resolve();
  assert.equal(await done, true);
  assert.deepEqual(state.revealed, []);
  assert.deepEqual(state.jumpedEditors, []);
  assert.deepEqual(state.jumps, [{ file: "/a.pdf", page: 4 }]);
  state.registration.dispose();
});
