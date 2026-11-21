import type { Context, Infer, Plugin } from "@workshop/core";
import type {} from "../editor/api";
import { config } from "./manifest";
import { WheelRails } from "./wheel-rails";

const rails = new WeakMap<Context, WheelRails>();

export const scrollAxisLockWebview: Plugin<Infer<typeof config>> = {
  name: "scrollAxisLock",
  config,
  inject: { required: ["editor"] },
  reconfigure(ctx, options) {
    const wheelRails = rails.get(ctx);
    if (!wheelRails) {
      return false;
    }
    follow(wheelRails, options.predominantAxis);
    return true;
  },
  apply(ctx, options) {
    const view = ctx.editor.view;
    const wheelRails = new WheelRails({
      dom: view.dom,
      scroller: view.scrollDOM,
      lineHeight: () => view.defaultLineHeight,
    });
    rails.set(ctx, wheelRails);
    follow(wheelRails, options.predominantAxis);
    ctx.effect(() => () => {
      wheelRails.stop();
      rails.delete(ctx);
    });
  },
};

/** `editor.scrollPredominantAxis` off leaves every gesture to the browser. */
function follow(wheelRails: WheelRails, predominantAxis: boolean): void {
  if (predominantAxis) {
    wheelRails.start();
  } else {
    wheelRails.stop();
  }
}
