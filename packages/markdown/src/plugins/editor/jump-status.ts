import { t } from "@workshop/l10n";
import type { StatusHandle, WorkbenchViews } from "../../shared/host";
import { contributionId } from "../../shared/setting-schema";

/** Where the note's jump history stands, for its status bar arrows. */
export interface JumpStatusState {
  /** A Lumiere Markdown editor is the active tab. */
  isNoteActive: boolean;
  canBack: boolean;
  canForward: boolean;
}

/**
 * Back and forward arrows on the status bar, as the PDF viewer has: the
 * editor title bar shows its arrows only once the note has a jump to go
 * back to, so the status bar is where they are always in view. They show
 * while a note is the active tab, and an arrow with nowhere to go has no
 * command (VS Code draws it as plain text that does nothing).
 *
 * Priorities above the word count (99) and backlinks (100) keep the arrows
 * to their left, back before forward.
 */
export function createJumpStatus(views: WorkbenchViews | undefined): {
  update(state: JumpStatusState): void;
  dispose(): void;
} {
  if (!views?.statusBar) {
    return { update() {}, dispose() {} };
  }
  const arrows: Array<{
    handle: StatusHandle;
    text: string;
    tooltip: () => string;
    command: string;
    can: (state: JumpStatusState) => boolean;
  }> = [
    {
      handle: views.status("lumiere.markdown.jumpBack", 102),
      text: "$(arrow-left)",
      tooltip: () => t("Go back in note"),
      command: contributionId("jumpBack"),
      can: (state) => state.canBack,
    },
    {
      handle: views.status("lumiere.markdown.jumpForward", 101),
      text: "$(arrow-right)",
      tooltip: () => t("Go forward in note"),
      command: contributionId("jumpForward"),
      can: (state) => state.canForward,
    },
  ];
  return {
    update(state) {
      for (const arrow of arrows) {
        if (!state.isNoteActive) {
          arrow.handle.hide();
          continue;
        }
        arrow.handle.show(
          arrow.text,
          arrow.tooltip(),
          arrow.can(state) ? arrow.command : undefined,
        );
      }
    },
    dispose() {
      for (const arrow of arrows) {
        arrow.handle.dispose();
      }
    },
  };
}
