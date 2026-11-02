import { ViewPlugin } from "@codemirror/view";
import type { Plugin } from "@workshop/core";
import type {} from "../commands/api";
import type {} from "../editor/api";
import { LOOK_UP_COMMAND } from "./manifest";
import { menuWord } from "./pointer-word";
import { protocol } from "./protocol";

/** The word under the note's last context menu; "" when there was none. */
interface MenuTarget {
  word: string;
}

/**
 * Look Up in the note's context menu: remembers the word the menu opened
 * on, and asks the host to open it in the Dictionary app when the item is
 * chosen. The host decides whether it can (macOS only).
 */
export const lookUpWebview: Plugin = {
  name: "lookUp",
  inject: { required: ["editor", "commands", "rpc"] },
  apply(ctx) {
    const target: MenuTarget = { word: "" };
    ctx.effect(() => ctx.editor.extend(recordMenuWord(target)));
    ctx.effect(() =>
      ctx.commands.register(LOOK_UP_COMMAND, async () =>
        target.word
          ? ctx.rpc.call(protocol, "lookUp", { word: target.word })
          : false,
      ),
    );
  },
};

/**
 * Reads the word when the menu opens, not when the item runs. On macOS the
 * secondary click selects the word, which moves the caret into that line,
 * and Live Preview then reveals the line's Markdown (a heading's `#`, a
 * link's brackets), shifting the text under the recorded point before the
 * command arrives. In the capture phase, so a widget that stops the event
 * cannot hide it. A plain listener on the editor element, because
 * CodeMirror's own handlers skip events inside widgets.
 */
function recordMenuWord(target: MenuTarget) {
  return ViewPlugin.define((view) => {
    const record = (event: MouseEvent) => {
      target.word = menuWord(view.contentDOM, {
        x: event.clientX,
        y: event.clientY,
      });
    };
    view.dom.addEventListener("contextmenu", record, true);
    return {
      destroy() {
        view.dom.removeEventListener("contextmenu", record, true);
      },
    };
  });
}
