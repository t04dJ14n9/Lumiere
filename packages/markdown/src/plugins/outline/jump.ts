import type { Logger } from "@workshop/core";
import type { Dialogs, HostDocument, HostSettings } from "../../shared/host";
import type { Vaults } from "../vault/api";
import { t } from "@workshop/l10n";

/** What a jump to a heading needs from the plugin's services. */
export interface HeadingJumps {
  vaults: Pick<Vaults, "open">;
  settings: Pick<HostSettings, "forNote">;
  dialogs: Pick<Dialogs, "inform">;
  logger: Logger;
}

/**
 * Opens a note at a heading's offset in the file. The jump is carried out by
 * the Links plugin of the note's editor: it registers the editor's reveal
 * with the navigation service and moves the view. Outline is one window
 * plugin and Links one per note, so Outline cannot inject it; with Links off
 * for the note (`document` is its open editor's, if any) the jump would wait
 * for a reveal that never registers and do nothing, so the user is told
 * instead. Any other failure is logged: the command runs from a tree row or
 * a picker, which have nowhere to show it.
 */
export async function jumpToHeading(
  jumps: HeadingJumps,
  note: { uri: string; document: HostDocument | undefined },
  sourceOffset: number,
): Promise<void> {
  const { document } = note;
  if (
    document &&
    jumps.settings.forNote(document).features?.links?.enabled === false
  ) {
    jumps.dialogs.inform(
      t(
        "Markdown Outline jumps to headings through the Links plugin, which is off for this note.",
      ),
    );
    return;
  }
  try {
    await jumps.vaults.open(note.uri, { offset: sourceOffset });
  } catch (error) {
    jumps.logger.warn("Markdown Outline could not jump to the heading", error);
  }
}
