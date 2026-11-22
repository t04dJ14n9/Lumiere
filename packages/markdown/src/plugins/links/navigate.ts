import type { Context } from "@workshop/core";
import { protocol } from "./protocol";
import {
  resolveNavigationTarget,
  setFlashing,
  unfoldTargetEffects,
} from "./target-highlight";
import { scrollTargetToTop } from "./scroll-to-top";
import { pinnedChromeHeight } from "../editor/api";

export type Navigate = (target: {
  fragment: string;
  at?: number;
  to?: number;
  preserveFocus?: boolean;
}) => boolean;

export function navigator(ctx: Context): Navigate {
  const view = ctx.editor.view;
  let jump = 0;
  return ({
    fragment,
    at,
    to,
    preserveFocus,
  }: {
    fragment: string;
    at?: number;
    to?: number;
    preserveFocus?: boolean;
  }) => {
    const target = resolveNavigationTarget(view.state, fragment, at, to);
    if (!target) {
      void ctx.rpc
        .call(protocol, "missing", { fragment })
        .catch((error) =>
          ctx.logger.warn("Missing-fragment message failed", error),
        );
      return false;
    }
    const generation = ++jump;
    ctx.editor.navigate(() => {
      // Focusing after measured scrolling can restore the previous viewport.
      if (!preserveFocus) {
        view.focus();
      }
      // Top of viewport, below the sticky bar the target will have (Outline /
      // Go to Heading / in-note fragments).
      scrollTargetToTop(
        view,
        target,
        [
          ...unfoldTargetEffects(view.state, target.from, target.to),
          setFlashing.of({ from: target.from, to: target.to }),
        ],
        {
          isCurrent: () => generation === jump,
          pinnedHeight: (position) =>
            view.state.facet(pinnedChromeHeight)(view, position),
          ...(ctx.editor.holdAtTop
            ? { holdAtTop: ctx.editor.holdAtTop.bind(ctx.editor) }
            : {}),
        },
      );
    });
    return true;
  };
}
