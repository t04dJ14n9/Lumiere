import type { Context, Disposer, Plugin } from "@workshop/core";
import {
  currentDateTime,
  expandTemplateWithReport,
} from "../../markdown/templates";
import { registerReportedCommands } from "../../shared/reported-command";
import { contributionId } from "../../shared/setting-schema";
import { baseName } from "../../shared/workspace-path";
import { insertAtCaret, insertTemplate } from "./insert";
import { templateFiles, templateFolder, templatePickItems } from "./list";
import { t } from "@workshop/l10n";

/**
 * **Lumiere: Templates**: insert a template note, or the current date or
 * time, at the caret.
 */
export const templatesHost: Plugin = {
  name: "templates",
  inject: {
    required: [
      "hostCommands",
      "hostDocuments",
      "dialogs",
      "settings",
      "vaults",
      "editors",
    ],
  },
  apply(ctx) {
    const effect = (setup: () => Disposer) => {
      ctx.effect(setup);
    };
    registerReportedCommands(
      effect,
      ctx.hostCommands,
      (message) => ctx.dialogs.error(message),
      [
        { id: contributionId("templates.insert"), run: () => insert(ctx) },
        {
          id: contributionId("templates.insertCurrentDate"),
          run: () => insertNow(ctx, "date"),
        },
        {
          id: contributionId("templates.insertCurrentTime"),
          run: () => insertNow(ctx, "time"),
        },
      ],
    );
  },
};

/**
 * Obsidian's Insert current date and Insert current time: the date or time
 * in the Templates format settings, at the caret, whether or not a
 * templates folder is set.
 */
async function insertNow(ctx: Context, kind: "date" | "time"): Promise<void> {
  const panel = ctx.editors.active();
  if (!panel) {
    ctx.dialogs.error(
      kind === "date"
        ? t("Open a note in Lumiere to insert the date.")
        : t("Open a note in Lumiere to insert the time."),
    );
    return;
  }
  const uri = panel.document.uri;
  await ctx.settings.effective.prepare(uri);
  const { text, unsupported } = currentDateTime(kind, {
    now: new Date(),
    dateFormat: ctx.settings.effective.get("templates.dateFormat", "", uri),
    timeFormat: ctx.settings.effective.get("templates.timeFormat", "", uri),
  });
  if (!(await insertAtCaret(ctx.hostDocuments, panel, text))) {
    ctx.dialogs.error(
      kind === "date"
        ? t("The date could not be inserted.")
        : t("The time could not be inserted."),
    );
  } else if (unsupported.length > 0) {
    const formats = unsupported.join(", ");
    ctx.dialogs.error(
      kind === "date"
        ? t(
            "The date format uses {0}, which Lumiere cannot format yet; it was inserted as written.",
            formats,
          )
        : t(
            "The time format uses {0}, which Lumiere cannot format yet; it was inserted as written.",
            formats,
          ),
    );
  }
}

async function insert(ctx: Context): Promise<void> {
  const panel = ctx.editors.active();
  if (!panel) {
    ctx.dialogs.error(t("Open a note in Lumiere to insert a template."));
    return;
  }
  const uri = panel.document.uri;
  const located = await ctx.vaults.locate(uri);
  const vault = located?.vault ?? (await ctx.vaults.forWorkspace());
  if (!vault) {
    ctx.dialogs.error(t("Open a folder to use templates."));
    return;
  }
  const resource = located ? uri : `${vault.index.root}/`;
  await ctx.settings.effective.prepare(resource);
  const get = (key: string, fallback: string) =>
    ctx.settings.effective.get(`templates.${key}`, fallback, resource);
  const folder = templateFolder(get("folder", ""));
  if (!folder) {
    ctx.dialogs.error(
      t(
        "Set lumiere.markdown.templates.folder to your templates folder first.",
      ),
    );
    return;
  }
  const files = templateFiles(vault.index.files(), folder);
  if (files.length === 0) {
    ctx.dialogs.error(t("No templates in {0}.", folder));
    return;
  }
  const picked = await ctx.dialogs.pick({
    placeholder: t("Insert a template"),
    items: (query) => templatePickItems(files, folder, query),
  });
  const file = picked?.item?.value;
  if (!file) {
    return;
  }
  const { text, unsupported } = expandTemplateWithReport(
    await ctx.vaults.text(file.uri),
    {
      title: baseName(uri).replace(/\.md$/i, ""),
      now: new Date(),
      dateFormat: get("dateFormat", ""),
      timeFormat: get("timeFormat", ""),
    },
  );
  const outcome = await insertTemplate(ctx.hostDocuments, panel, text);
  const messages = insertionMessages({
    ...outcome,
    unsupported,
    note: baseName(uri),
    template: file.path,
  });
  messages.forEach((message) => ctx.dialogs.error(message));
}

/** What the insertion could not do as Obsidian would, for the user. */
export function insertionMessages(outcome: {
  isInserted: boolean;
  invalidProperties?: "note" | "template";
  unsupported: string[];
  /** The note's file name and the template's vault path, to name the culprit. */
  note: string;
  template: string;
}): string[] {
  if (!outcome.isInserted) {
    return [t("The template could not be inserted.")];
  }
  const messages: string[] = [];
  const { unsupported } = outcome;
  if (unsupported.length > 0) {
    const formats = unsupported.join(", ");
    messages.push(
      unsupported.length === 1
        ? t(
            "The template's date format uses {0}, which Lumiere cannot format yet; it was inserted as written.",
            formats,
          )
        : t(
            "The template's date format uses {0}, which Lumiere cannot format yet; they were inserted as written.",
            formats,
          ),
    );
  }
  if (outcome.invalidProperties === "note") {
    messages.push(
      t(
        "The template's properties were not added: the properties of {0} are not valid YAML.",
        outcome.note,
      ),
    );
  }
  if (outcome.invalidProperties === "template") {
    messages.push(
      t(
        "The template's properties were not added: the properties of the template {0} are not valid YAML once its variables are filled in. Only its body was inserted.",
        outcome.template,
      ),
    );
  }
  return messages;
}
