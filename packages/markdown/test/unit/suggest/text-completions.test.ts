import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import { test } from "node:test";
import type { TextCompletion } from "../../../src/shared/host";
import { Position, registrations } from "../support/completion-fake";

const resolver = Module as unknown as {
  _resolveFilename(request: string, ...rest: unknown[]): string;
};
const resolve = resolver._resolveFilename;
resolver._resolveFilename = function (request, ...rest) {
  return request === "vscode"
    ? path.join(import.meta.dirname, "../support/completion-fake.ts")
    : resolve.call(this, request, ...rest);
};

const entry = (
  label: string,
  detail = "",
  replaceFrom = 2,
): TextCompletion => ({
  label,
  detail,
  insert: `${label}]]`,
  replaceFrom,
  absorbs: "]]",
});

async function ask(options: {
  line: string;
  caret: number;
  entries: TextCompletion[];
  cancelled?: boolean;
}) {
  const { registerTextCompletions } =
    await import("../../../src/host/text-completions");
  const requests: unknown[] = [];
  const registration = registerTextCompletions({
    complete: async (request) => {
      requests.push(request);
      return options.entries;
    },
  });
  const registered = registrations.at(-1)!;
  const list = await registered.provider.provideCompletionItems(
    {
      uri: { toString: () => "file:///vault/Note.md" },
      lineAt: () => ({ text: options.line }),
    },
    new Position(3, options.caret),
    { isCancellationRequested: options.cancelled === true },
  );
  return { list, requests, registered, registration };
}

test("notes on disk are completed after every separator, and the provider withdraws on dispose", async () => {
  const { registered, registration } = await ask({
    line: "[[Targ]]",
    caret: 6,
    entries: [],
  });
  assert.deepEqual(registered.selector, {
    language: "markdown",
    scheme: "file",
  });
  for (const character of ["[", "#", "^", "|", " ", "/", "-", "'", "("]) {
    assert.ok(registered.triggers.includes(character), character);
  }
  assert.ok(!registered.triggers.includes("a"));
  registration.dispose();
  assert.equal(registered.disposed, true);
});

test("entries reach VS Code in order, each matching what was typed, in a list it asks again for", async () => {
  const { list, requests } = await ask({
    line: "see [[Targ]] now",
    caret: 10,
    entries: [entry("Target Note", "Target Note.md", 6), entry("Other", "", 6)],
  });
  assert.deepEqual(requests, [
    { uri: "file:///vault/Note.md", before: "see [[Targ" },
  ]);
  assert.equal(list!.isIncomplete, true);
  const [first, second] = list!.items;
  assert.deepEqual(first!.label, {
    label: "Target Note",
    description: "Target Note.md",
  });
  assert.equal(second!.label, "Other");
  assert.equal(first!.insertText, "Target Note]]");
  assert.equal(first!.filterText, "Targ");
  assert.deepEqual(
    list!.items.map((item) => item.sortText),
    ["000", "001"],
  );
  // From the typed text to the caret, and the `]]` that follows it.
  assert.deepEqual(
    [first!.range!.start.character, first!.range!.end.character],
    [6, 12],
  );
});

test("a closing bracket after the caret is taken over as far as it is there", async () => {
  const cases: [after: string, taken: number][] = [
    ["]] text", 2],
    ["] text", 1],
    ["]]]", 2],
    [" text", 0],
    ["", 0],
  ];
  for (const [after, taken] of cases) {
    const line = `[[Targ${after}`;
    const { list } = await ask({ line, caret: 6, entries: [entry("A")] });
    assert.equal(list!.items[0]!.range!.end.character, 6 + taken, after);
  }
});

test("nothing is offered when nothing matches or the request was cancelled", async () => {
  assert.equal(
    (await ask({ line: "[[Targ", caret: 6, entries: [] })).list,
    undefined,
  );
  assert.equal(
    (
      await ask({
        line: "[[Targ",
        caret: 6,
        entries: [entry("A")],
        cancelled: true,
      })
    ).list,
    undefined,
  );
});
