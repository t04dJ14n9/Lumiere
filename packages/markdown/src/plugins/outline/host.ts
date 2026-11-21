import type { Context, Plugin } from "@workshop/core";
import type { TreeHandle } from "../../shared/host";
import type { EditorPanel } from "../editor/api";
import type {} from "../vault/api";
import {
  expandMode,
  followsCursor,
  registerFollowCursor,
  registerOutlineActions,
  registerOutlineCommandContext,
} from "./actions";
import { OPEN_COMMAND, VIEW_ID } from "./commands";
import { createOutlineFocus } from "./focus";
import { jumpToHeading, type HeadingJumps } from "./jump";
import { protocol } from "./protocol";
import { sectionMover } from "./section-drag";
import { registerSymbolPicker } from "./symbol-picker";
import { OutlineSource } from "./tree";
import { OutlineView } from "./view";

/** The active panel's headings, with native expansion actions and optional following. */
export const outlineHost: Plugin = {
  name: "outline",
  inject: {
    required: [
      "hostCommands",
      "settings",
      "vaults",
      "editors",
      "views",
      "dialogs",
      "activeEditor",
      "hostDocuments",
    ],
  },
  apply(ctx) {
    const editors = ctx.editors;
    const source = new OutlineSource(
      sectionMover({
        editors,
        hostDocuments: ctx.hostDocuments,
        dialogs: ctx.dialogs,
      }),
    );
    const tree = ctx.views.tree(VIEW_ID, source, { showCollapseAll: true });
    ctx.effect(() => () => tree.dispose());
    const view = new OutlineView({
      source,
      tree,
      editors,
      logger: ctx.logger,
      followsCursor: () =>
        followsCursor(ctx.settings, editors.active()?.document.uri),
      expandMode: () =>
        expandMode(ctx.settings, editors.active()?.document.uri),
    });
    ctx.effect(() => () => view.dispose());
    registerOutlineCommandContext(ctx);
    registerOutlineUpdates(ctx, view, tree);
    registerReadingPosition(ctx, view);
    registerOutlineActions(ctx, view, tree);
    registerFollowCursor(ctx, view);
    registerSymbolPicker(ctx, ctx.dialogs);
    registerOutlineFocus(ctx, tree);
    registerHeadingRows(ctx, view);
    view.refresh();
  },
};

/**
 * A click on a row: its command carries the note's URI and the heading's
 * offset in the file (and a revision, which only a drop reads).
 */
function registerHeadingRows(ctx: Context, view: OutlineView): void {
  const jumps: HeadingJumps = {
    vaults: ctx.vaults,
    settings: ctx.settings,
    dialogs: ctx.dialogs,
    logger: ctx.logger,
  };
  ctx.effect(() =>
    ctx.hostCommands.register(OPEN_COMMAND, (uri, offset) => {
      const note = String(uri);
      view.jumpedTo(Number(offset));
      return jumpToHeading(
        jumps,
        {
          uri: note,
          document: ctx.editors
            .all()
            .find((panel) => panel.document.uri === note)?.document,
        },
        Number(offset),
      );
    }),
  );
}

function registerOutlineUpdates(
  ctx: Context,
  view: OutlineView,
  tree: TreeHandle,
): void {
  // An editor opened already active may not emit activeChanged.
  ctx.on("editor/opened", () => view.refresh());
  ctx.on("editor/closed", () => view.refresh());
  ctx.on("editor/activeChanged", () => view.refresh());
  ctx.on("editor/ready", () => view.refresh());
  ctx.on("document/changed", (session) => {
    if (session.document.uri === ctx.editors.active()?.document.uri) {
      view.schedule();
    }
  });
  ctx.on("editor/selectionChanged", (panel) => {
    if (panel === ctx.editors.active()) {
      void view.followCaret();
    }
  });
  ctx.effect(() =>
    tree.onVisibilityChanged((visible) => {
      if (visible) {
        view.refresh();
      }
    }),
  );
}

/** Each panel's scroll reports, followed while the panel is active. */
function registerReadingPosition(ctx: Context, view: OutlineView): void {
  const listening = new Map<string, () => void>();
  const listen = (panel: EditorPanel) => {
    if (listening.has(panel.id)) {
      return;
    }
    listening.set(
      panel.id,
      panel.rpc.on(protocol, "readingPosition", (position) => {
        if (panel === ctx.editors.active()) {
          void view.followReading(panel, position);
        }
      }),
    );
  };
  ctx.on("editor/opened", (opened) => {
    const panel = ctx.editors.all().find((item) => item.id === opened.id);
    if (panel) {
      listen(panel);
    }
  });
  ctx.on("editor/closed", (closed) => {
    listening.get(closed.id)?.();
    listening.delete(closed.id);
  });
  ctx.effect(() => () => {
    for (const stop of listening.values()) {
      stop();
    }
    listening.clear();
  });
  for (const panel of ctx.editors.all()) {
    listen(panel);
  }
}

function registerOutlineFocus(ctx: Context, tree: TreeHandle): void {
  // Captured while live: the focus check can run after the plugin stops.
  const activeEditor = ctx.activeEditor;
  const focus = createOutlineFocus({
    execute: (command, ...args) => ctx.hostCommands.execute(command, ...args),
    isOutlineShown: () => tree.visible,
    activeCustomEditorViewType: () => activeEditor.customEditorViewType(),
  });
  ctx.effect(() => () => focus.dispose());
  // The view is on screen only where the Explorer is the sidebar's container.
  ctx.effect(() =>
    tree.onVisibilityChanged((visible) => {
      if (visible) {
        focus.outlineShown();
      }
    }),
  );
  const sync = () => {
    const active = ctx.editors.active();
    focus.sync(Boolean(active && !active.openedFromNativeSelection));
  };
  ctx.on("editor/opened", sync);
  ctx.on("editor/closed", sync);
  ctx.on("editor/activeChanged", sync);
  // An already-active panel may not emit activeChanged at startup.
  sync();
}
