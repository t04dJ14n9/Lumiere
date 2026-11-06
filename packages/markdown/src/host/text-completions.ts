import * as vscode from "vscode";
import type { TextCompletion, TextCompletionProvider } from "../shared/host";
import type { Cancellation } from "../shared/rpc/lifecycle";

/**
 * VS Code closes its suggest list when the user types a character that is not
 * part of a word, and a note name holds many (a space, `/`, `-`). Being asked
 * again after each of them keeps the list open. These are the characters of
 * its default `editor.wordSeparators`, which include the `[`, `#`, `^` and `|`
 * that start or change a link, and the space.
 */
const TRIGGER_CHARACTERS = [..."`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/? "];

/** Notes on disk in the workspace; the provider decides where it answers. */
const NOTES: vscode.DocumentSelector = { language: "markdown", scheme: "file" };

export function registerTextCompletions(
  provider: TextCompletionProvider,
): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    NOTES,
    {
      async provideCompletionItems(document, position, token) {
        const line = document.lineAt(position.line).text;
        const before = line.slice(0, position.character);
        const entries = await provider.complete(
          { uri: document.uri.toString(), before },
          cancellation(token),
        );
        if (token.isCancellationRequested || entries.length === 0) {
          return undefined;
        }
        const after = line.slice(position.character);
        // Incomplete, so that VS Code asks again at every keystroke instead of
        // filtering this list by its own rules.
        return new vscode.CompletionList(
          entries.map((entry, rank) =>
            completionItem(entry, { rank, position, before, after }),
          ),
          true,
        );
      },
    },
    ...TRIGGER_CHARACTERS,
  );
}

function completionItem(
  entry: TextCompletion,
  at: {
    rank: number;
    position: vscode.Position;
    before: string;
    after: string;
  },
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(
    entry.detail
      ? { label: entry.label, description: entry.detail }
      : entry.label,
    vscode.CompletionItemKind.Reference,
  );
  item.insertText = entry.insert;
  const absorbed = entry.absorbs ? absorbedLength(entry.absorbs, at.after) : 0;
  item.range = new vscode.Range(
    at.position.line,
    entry.replaceFrom,
    at.position.line,
    at.position.character + absorbed,
  );
  // The plugin has ranked and matched these already. Filtering by what was
  // typed makes every entry match it equally, so VS Code's own fuzzy match
  // (which knows nothing of paths or aliases) hides none, and the sort text
  // keeps the plugin's order.
  item.filterText = at.before.slice(entry.replaceFrom);
  item.sortText = String(at.rank).padStart(3, "0");
  return item;
}

/**
 * How much of `absorbs` follows the caret: all of it, or its first characters.
 * VS Code's closing brackets can leave a single `]` after `[[`.
 */
function absorbedLength(absorbs: string, after: string): number {
  let length = absorbs.length;
  while (length > 0 && !after.startsWith(absorbs.slice(0, length))) {
    length--;
  }
  return length;
}

function cancellation(token: vscode.CancellationToken): Cancellation {
  return {
    get cancelled() {
      return token.isCancellationRequested;
    },
    onCancel(callback) {
      if (token.isCancellationRequested) {
        callback();
        return () => {};
      }
      const subscription = token.onCancellationRequested(callback);
      return () => subscription.dispose();
    },
  };
}
