import { linkSuggestion } from "./suggestions";
import { Prec } from "@codemirror/state";
import { ViewPlugin, keymap } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import type { Context, Plugin } from "@workshop/core";
import type {} from "../editor/api";
import type {} from "../commands/api";
import type { InlineRenderer } from "../livePreview/api";
import {
  isUnresolved,
  knownNotes,
  setKnownNotes,
  setUnresolved,
  unresolvedLinks,
} from "./api";
import { sourceUnresolved } from "./source-unresolved";
export { isUnresolved, knownNotes, unresolvedLinks } from "./api";
import { tagUnresolvedAnchors } from "./tag-unresolved-anchors";
import { protocol } from "./protocol";
import { linkAt, followCaretLink, referenceLinkAt } from "./caret-link";
import { wikilinkEdit } from "../../markdown/wikilink-edit";
import { linkClickHandlers, type OpenLink } from "./clicks";
import { bindFlashingLifecycle, flashingHighlights } from "./target-highlight";
import { navigator, type Navigate } from "./navigate";
export { linkAt } from "./caret-link";

export const linksWebview: Plugin = {
  name: "links",
  inject: { required: ["editor", "livePreview", "commands", "rpc"] },
  provides: ["links"],
  // Link options are consumed by the host on each request. Keep this view's
  // listeners and navigation-session lifetime when only those options change.
  reconfigure() {
    return true;
  },
  apply(ctx) {
    const flashing = bindFlashingLifecycle(ctx.editor.view);
    ctx.effect(() => () => flashing.dispose());
    ctx.effect(() =>
      ctx.editor.extend([
        sourceUnresolved(),
        flashingHighlights(),
        flashing.extension,
      ]),
    );
    ctx.on("suggest/trigger", linkSuggestion);
    const navigate = navigator(ctx);
    const open = linkOpener(ctx, navigate);
    registerNavigation(ctx, navigate);
    const unresolvedBySource = new Map<string, Promise<readonly string[]>>();
    registerUnresolvedLinks(ctx, unresolvedBySource);
    registerEmbedUnresolved(ctx, unresolvedBySource);
    registerKnownNotes(ctx, unresolvedBySource);
    registerWikiLinks(ctx);
    registerLinkClicks(ctx, open);
    registerLinkCommands(ctx, open);
    registerLinkFollowing(ctx, open);
  },
};

function linkOpener(ctx: Context, navigate: Navigate): OpenLink {
  return async (href, wiki, { side = false, tab = false, source } = {}) => {
    const request = {
      href,
      wiki,
      side,
      tab,
      ...(source === undefined ? {} : { source }),
    };
    if (ctx.bail("link/click", request)) {
      return true;
    }
    if (href.startsWith("#") && !side && !source) {
      return navigate({ fragment: href.slice(1) });
    }
    return ctx.rpc.call(protocol, "open", request);
  };
}

function registerNavigation(ctx: Context, navigate: Navigate): void {
  const session = crypto.getRandomValues(new Uint32Array(4)).join("-");
  let live = true;
  let latest = 0;
  ctx.effect(() => () => {
    live = false;
  });
  ctx.effect(() =>
    ctx.rpc.handle(protocol, "navigate", async (target, token) => {
      if (
        token.cancelled ||
        target.session !== session ||
        !live ||
        target.requestId <= latest
      ) {
        return false;
      }
      latest = target.requestId;
      if (!navigate(target)) {
        return false;
      }
      const state = ctx.editor.view.state;
      return (
        (await ctx.editor.settled()) &&
        !token.cancelled &&
        live &&
        latest === target.requestId &&
        state.selection.eq(ctx.editor.view.state.selection) &&
        state.doc.eq(ctx.editor.view.state.doc)
      );
    }),
  );
  void ctx.rpc
    .call(protocol, "ready", { session })
    .catch((error) =>
      ctx.logger.warn("Link navigation readiness failed", error),
    );
}

/** Ask the host for the note's unresolved links, then follow its updates. */
function registerUnresolvedLinks(
  ctx: Context,
  unresolvedBySource: Map<string, Promise<readonly string[]>>,
): void {
  const view = ctx.editor.view;
  let live = true;
  ctx.effect(() => () => {
    live = false;
    unresolvedBySource.clear();
  });
  const apply = (paths: readonly string[]) => {
    if (!live) {
      return;
    }
    unresolvedBySource.clear();
    unresolvedBySource.set("", Promise.resolve(paths));
    const effect = setUnresolved.of(new Set(paths));
    if (!ctx.editor.dispatchEffect?.(effect)) {
      view.dispatch({ effects: effect });
    }
    void refreshRenderedUnresolved(ctx, view);
  };
  ctx.effect(() => ctx.editor.extend(unresolvedLinks));
  ctx.effect(() => ctx.rpc.on(protocol, "unresolvedChanged", apply));
  const initial = ctx.rpc.call(protocol, "unresolved", {});
  unresolvedBySource.set("", initial);
  void initial.then(apply).catch((error) => {
    unresolvedBySource.delete("");
    ctx.logger.warn("Unresolved links unavailable", error);
  });
}

/** Ask the host for vault note keys, then follow index resolution. */
function registerKnownNotes(
  ctx: Context,
  unresolvedBySource: Map<string, Promise<readonly string[]>>,
): void {
  const view = ctx.editor.view;
  let live = true;
  ctx.effect(() => () => {
    live = false;
  });
  const apply = (keys: readonly string[]) => {
    if (live) {
      unresolvedBySource.clear();
      const effect = setKnownNotes.of(new Set(keys));
      if (!ctx.editor.dispatchEffect?.(effect)) {
        view.dispatch({ effects: effect });
      }
    }
  };
  ctx.effect(() => ctx.editor.extend(knownNotes));
  ctx.effect(() => ctx.rpc.on(protocol, "knownNotesChanged", apply));
  void ctx.rpc
    .call(protocol, "knownNotes", {})
    .then(apply)
    .catch((error) => ctx.logger.warn("Known notes unavailable", error));
}

/**
 * Dim unresolved anchors inside rendered HTML (note embeds) using that note's
 * outbound unresolved set — not the host note's. Markdown links count as much
 * as wikilinks: an embed may hold only `[label](Missing.md)`.
 */
export function registerEmbedUnresolved(
  ctx: Context,
  unresolvedBySource: Map<string, Promise<readonly string[]>>,
): void {
  ctx.on("render/postProcess", (pass) => {
    const source = pass.documentUri ?? "";
    if (!source) {
      const current = ctx.editor.view.state.field(unresolvedLinks, false);
      if (current && current.size > 0) {
        tagUnresolvedAnchors(pass.container, current);
      }
    }
    let pending = unresolvedBySource.get(source);
    if (!pending) {
      pending = ctx.rpc.call(protocol, "unresolved", source ? { source } : {});
      unresolvedBySource.set(source, pending);
    }
    void pending
      .then((paths) => {
        if (!ctx.isLive || !pass.container.isConnected) {
          return;
        }
        tagUnresolvedAnchors(pass.container, new Set(paths));
      })
      .catch((error) => {
        unresolvedBySource.delete(source);
        ctx.logger.warn("Embed unresolved links unavailable", error);
      });
  });
}

/** Re-tag every rendered surface after the vault re-resolves links. */
async function refreshRenderedUnresolved(
  ctx: Context,
  view: EditorView,
): Promise<void> {
  // Plugin teardown can clear contentDOM before a late unresolved RPC lands.
  if (!view.contentDOM?.isConnected) {
    return;
  }
  const roots = [
    ...view.contentDOM.querySelectorAll<HTMLElement>(".markdown-rendered"),
  ];
  if (roots.length === 0) {
    return;
  }
  const groups = new Map<string, HTMLElement[]>();
  for (const root of roots) {
    const source = root.dataset.noteSource ?? "";
    const list = groups.get(source) ?? [];
    list.push(root);
    groups.set(source, list);
  }
  for (const [source, elements] of groups) {
    try {
      const paths = await ctx.rpc.call(
        protocol,
        "unresolved",
        source ? { source } : {},
      );
      const unresolved = new Set(paths);
      for (const element of elements) {
        tagUnresolvedAnchors(element, unresolved);
      }
    } catch (error) {
      ctx.logger.warn("Embed unresolved refresh failed", error);
    }
  }
}

function registerWikiLinks(ctx: Context): void {
  ctx.effect(() => ctx.livePreview.inline(wikiLinkRenderer));
}

export const wikiLinkRenderer: InlineRenderer = {
  nodes: ["WikiLink"],
  decorate(node, cx) {
    const text = cx.state.sliceDoc(node.from + 2, node.to - 2);
    const separator = text.indexOf("|");
    const href = text.split("|")[0]!;
    const revealed = cx.revealed(node.from, node.to);
    // A link within the note shows without its `#`, as in Obsidian.
    const local = separator < 0 && href.length > 1 && href.startsWith("#");
    // Text starts after `[[`, and after the alias's `|` or a local `#`.
    let skip = separator + 1;
    if (separator < 0) {
      skip = local ? 1 : 0;
    }
    const from = node.from + 2 + skip;
    // Unresolved styling shows only while the link is rendered.
    let cls = "md-link";
    if (!revealed) {
      cls += isUnresolved(cx.state, href)
        ? " md-link-rendered is-unresolved"
        : " md-link-rendered";
    }
    cx.mark(
      revealed ? node.from : from,
      revealed ? node.to : node.to - 2,
      cls,
      { "data-href": href, "data-wiki": "true" },
    );
    if (!revealed) {
      cx.hide(node.from, from);
      cx.hide(node.to - 2, node.to);
    }
  },
};

function registerLinkClicks(ctx: Context, open: OpenLink): void {
  const view = ctx.editor.view;
  const handlers = linkClickHandlers(view, open, (error) =>
    ctx.logger.error("Link failed", error),
  );
  ctx.effect(() =>
    ctx.editor.extend(
      ViewPlugin.fromClass(
        class {
          private readonly events = new AbortController();
          constructor() {
            view.dom.addEventListener("mousedown", handlers.mousedown, {
              capture: true,
              signal: this.events.signal,
            });
            view.dom.addEventListener("click", handlers.click, {
              signal: this.events.signal,
            });
          }
          destroy(): void {
            this.events.abort();
          }
        },
      ),
    ),
  );
}

function registerLinkCommands(ctx: Context, open: OpenLink): void {
  const view = ctx.editor.view;
  ctx.effect(() =>
    ctx.commands.register("editor:insert-wikilink", () => {
      view.dispatch(wikilinkEdit(view.state, false));
      return true;
    }),
  );
  for (const [command, place] of [
    ["editor:follow-link", {}],
    ["editor:open-link-in-new-leaf", { tab: true }],
    ["editor:open-link-in-new-split", { side: true }],
  ] as const) {
    ctx.effect(() =>
      ctx.commands.register(command, async () => {
        const { state } = view;
        const text = state.doc.toString();
        const at = state.selection.main.head;
        // As in Obsidian, the commands follow a reference link or a tag
        // too; the editor's own Mod+Enter (followCaretLink) does not.
        const link = linkAt(text, at) ?? referenceLinkAt(text, at);
        if (link) {
          return open(link.href, link.wiki, place);
        }
        return ctx.bail("links/followToken", state, at) === true;
      }),
    );
  }
}

function registerLinkFollowing(ctx: Context, open: OpenLink): void {
  const report = (error: unknown) =>
    ctx.logger.warn("Follow link failed", error);
  const follow = (view: EditorView) => followCaretLink(view, open, report);
  const followBeside = (view: EditorView) =>
    followCaretLink(
      view,
      (href, wiki) => open(href, wiki, { side: true }),
      report,
    );
  ctx.provide("links", { follow });
  ctx.effect(() =>
    ctx.editor.extend(
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: follow,
          },
          // Obsidian's Open Link to Side key, also contributed to VS Code;
          // stopping propagation keeps VS Code from running it a second time.
          {
            key: "Mod-Alt-Enter",
            run: followBeside,
            stopPropagation: true,
          },
        ]),
      ),
    ),
  );
}
