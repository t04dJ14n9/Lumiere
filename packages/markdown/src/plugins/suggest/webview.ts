import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionKeymap,
  completionStatus,
  moveCompletionSelection,
  selectedCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  keymap,
  ViewPlugin,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import {
  bindCaller,
  type CallerBound,
  type Context,
  type Plugin,
} from "@workshop/core";
import type {} from "../editor/api";
import type { LocalSuggestions, Suggest, SuggestionTrigger } from "./api";
import { CancelToken } from "../../shared/rpc/lifecycle";
import { protocol } from "./protocol";
import { acceptSuggestion, type BlockIdHost } from "./accept";
import { registerCompletionHooks } from "../../shared/completion-hooks";
import {
  allowsSuggestions,
  asksForSuggestions,
  completionEdit,
} from "./completion";

registerCompletionHooks({ completionStatus, moveCompletionSelection });

export const suggestWebview: Plugin = {
  name: "suggest",
  inject: { required: ["editor", "rpc"] },
  provides: ["suggest"],
  apply(ctx) {
    ctx.effect(() =>
      registerCompletionHooks({ completionStatus, moveCompletionSelection }),
    );
    registerSources(ctx);
    registerCompletions(ctx);
  },
};
function registerSources(ctx: Context): void {
  const service: Suggest & CallerBound<Suggest> = {
    register: (source) => ctx.on("suggest/trigger", source),
    [bindCaller]: (caller) => ({
      register: (source) => caller.on("suggest/trigger", source),
    }),
  };
  ctx.provide("suggest", service);
}
function registerCompletions(ctx: Context): void {
  const pending = new Set<CancelToken>();
  ctx.effect(() => () => {
    for (const token of pending) {
      token.cancel();
    }
    pending.clear();
  });
  const source = (context: CompletionContext) => {
    const trigger = ctx.bail("suggest/trigger", context);
    if (!trigger) {
      return null;
    }
    // Resolve the kind first so tags may open inside code / frontmatter
    // (Obsidian); links and local lists stay blocked there.
    const kind = "options" in trigger ? undefined : trigger.kind;
    if (!allowsSuggestions(context.state, context.pos, kind)) {
      return null;
    }
    return "options" in trigger
      ? localCompletions(trigger)
      : requestCompletions(ctx, { context, trigger, pending });
  };
  ctx.effect(() =>
    ctx.editor.extend(
      [
        autocompletion({
          override: [source],
          icons: false,
          maxRenderedOptions: 50,
          defaultKeymap: false,
          addToOptions: [{ render: renderSwatch, position: 20 }],
        }),
        keymap.of([
          {
            key: "Escape",
            run: (view) =>
              completionStatus(view.state) === "active" &&
              closeCompletion(view),
          },
          // As in Obsidian: Tab takes the suggestion without finishing the
          // link, so `#` or `|` can follow.
          { key: "Tab", run: acceptWithTab },
          // Obsidian 1.13: Ctrl+N and Ctrl+P move through suggestions on
          // every platform.
          { key: "Ctrl-n", run: moveCompletionSelection(true) },
          { key: "Ctrl-p", run: moveCompletionSelection(false) },
          ...completionKeymap.filter((binding) => binding.key !== "Escape"),
        ]),
        openOnRequest,
      ],
      { slot: "suggest" },
    ),
  );
}

/** Opens suggestions after an edit that asks for them (Insert Wikilink). */
const openOnRequest = ViewPlugin.fromClass(
  class {
    private destroyed = false;
    constructor(private readonly view: EditorView) {}
    update(update: ViewUpdate): void {
      if (!asksForSuggestions(update.transactions)) {
        return;
      }
      // A view cannot dispatch while it is updating.
      queueMicrotask(() => {
        if (!this.destroyed) {
          startCompletion(this.view);
        }
      });
    }
    destroy(): void {
      this.destroyed = true;
    }
  },
);
async function requestCompletions(
  ctx: Context,
  options: {
    context: CompletionContext;
    trigger: SuggestionTrigger;
    pending: Set<CancelToken>;
  },
): Promise<CompletionResult | null> {
  const { context, trigger, pending } = options;
  const token = new CancelToken();
  pending.add(token);
  context.addEventListener("abort", () => token.cancel(), {
    onDocChange: true,
  });
  try {
    const items = await ctx.rpc.call(
      protocol,
      "query",
      {
        kind: trigger.kind,
        query: trigger.query,
        ...(trigger.note === undefined ? {} : { note: trigger.note }),
        ...(trigger.bare && { bare: true }),
        ...(trigger.destination && { destination: trigger.destination }),
        ...(trigger.kind === "block" &&
          trigger.note === undefined && { caret: context.pos }),
      },
      { token },
    );
    if (context.aborted || token.cancelled) {
      return null;
    }
    return {
      from: trigger.from,
      filter: false,
      options: items.map((item) => ({
        label: item.label,
        detail: item.detail,
        apply: (view, _completion, from, to) =>
          acceptSuggestion({
            view,
            edit: acceptance(view, { from, to }, item, trigger),
            blockId: item.blockId,
            host: blockIdHost(ctx),
          }),
      })),
    };
  } catch (error) {
    if (!token.cancelled) {
      ctx.logger.warn("Suggestions unavailable", error);
    }
    return null;
  } finally {
    pending.delete(token);
  }
}

function blockIdHost(ctx: Context): BlockIdHost {
  return {
    write: (blockId) => ctx.rpc.call(protocol, "addBlockId", blockId),
    changed: () => ctx.rpc.notify(protocol, "blockChanged", {}),
    warn: (message, error) => ctx.logger.warn(message, error),
  };
}

/** A completion from a local list: Tab does not take it. */
interface LocalCompletion extends Completion {
  local: true;
  swatch?: string;
}

export function localCompletions(list: LocalSuggestions): CompletionResult {
  return {
    from: list.at,
    filter: false,
    options: list.options.map((option): LocalCompletion => ({
      label: option.label,
      local: true,
      ...(option.swatch && { swatch: option.swatch }),
      apply: (view, _completion, from, to) =>
        view.dispatch({
          ...option.apply(view.state, { from, to }),
          userEvent: "input.complete",
        }),
    })),
  };
}

function renderSwatch(completion: Completion): Node | null {
  const swatch = (completion as Partial<LocalCompletion>).swatch;
  if (!swatch) {
    return null;
  }
  const element = document.createElement("span");
  element.className = "md-highlight-swatch";
  element.dataset.highlight = swatch;
  return element;
}

/** Set while Tab accepts, which CodeMirror's apply callback cannot tell. */
let acceptingWithTab = false;

function acceptWithTab(view: EditorView): boolean {
  if (completionStatus(view.state) !== "active") {
    return false;
  }
  // Obsidian's Tab leaves a highlight colour list open and takes nothing.
  if ((selectedCompletion(view.state) as Partial<LocalCompletion>)?.local) {
    return true;
  }
  acceptingWithTab = true;
  try {
    return acceptCompletion(view);
  } finally {
    acceptingWithTab = false;
  }
}

/**
 * The edit for an accepted suggestion, as Obsidian makes it: Enter finishes
 * a link (`]]`, or `)` inside a Markdown link) or adds the space after a tag;
 * Tab only takes the text; with an alias typed, the typed text stays and only
 * the link is finished.
 */
function acceptance(
  view: EditorView,
  range: { from: number; to: number },
  item: { insert: string; replaceLink?: boolean | undefined },
  trigger: SuggestionTrigger,
) {
  const tab = acceptingWithTab;
  const closer = trigger.destination ? ")" : "]]";
  if (trigger.keepTyped) {
    return completionEdit(view.state, { from: range.to, to: range.to }, "", {
      close: !tab && trigger.closeLink,
    });
  }
  if (tab) {
    return completionEdit(view.state, range, item.insert, { close: false });
  }
  return completionEdit(view.state, range, item.insert, {
    close: item.replaceLink ? "replace" : trigger.closeLink,
    closer,
    spaceAfter: trigger.spaceAfter === true,
  });
}
