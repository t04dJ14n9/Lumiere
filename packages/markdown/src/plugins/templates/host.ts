import type { Context, Disposer, Plugin } from "@workshop/core";
import { expandTemplateWithReport } from "../../markdown/templates";
import { registerReportedCommands } from "../../shared/reported-command";
import { contributionId } from "../../shared/setting-schema";
import { baseName } from "../../shared/workspace-path";
import { insertTemplate } from "./insert";
import { templateFiles, templateFolder, templatePickItems } from "./list";

/** **Lumiere: Templates**: insert a template note at the caret. */
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
      [{ id: contributionId("templates.insert"), run: () => insert(ctx) }],
    );
  },
};

async function insert(ctx: Context): Promise<void> {
  const panel = ctx.editors.active();
  if (!panel) {
    ctx.dialogs.error("Open a note in Lumiere to insert a template.");
    return;
  }
  const uri = panel.document.uri;
  const located = await ctx.vaults.locate(uri);
  const vault = located?.vault ?? (await ctx.vaults.forWorkspace());
  if (!vault) {
    ctx.dialogs.error("Open a folder to use templates.");
    return;
  }
  const resource = located ? uri : `${vault.index.root}/`;
  await ctx.settings.effective.prepare(resource);
  const get = (key: string, fallback: string) =>
    ctx.settings.effective.get(`templates.${key}`, fallback, resource);
  const folder = templateFolder(get("folder", ""));
  if (!folder) {
    ctx.dialogs.error(
      "Set lumiere.markdown.templates.folder to your templates folder first.",
    );
    return;
  }
  const files = templateFiles(vault.index.files(), folder);
  if (files.length === 0) {
    ctx.dialogs.error(`No templates in ${folder}.`);
    return;
  }
  const picked = await ctx.dialogs.pick({
    placeholder: "Insert a template",
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
    return ["The template could not be inserted."];
  }
  const messages: string[] = [];
  const { unsupported } = outcome;
  if (unsupported.length > 0) {
    const verb = unsupported.length === 1 ? "it was" : "they were";
    messages.push(
      `The template's date format uses ${unsupported.join(", ")}, which Lumiere cannot format yet; ${verb} inserted as written.`,
    );
  }
  if (outcome.invalidProperties === "note") {
    messages.push(
      `The template's properties were not added: the properties of ${outcome.note} are not valid YAML.`,
    );
  }
  if (outcome.invalidProperties === "template") {
    messages.push(
      `The template's properties were not added: the properties of the template ${outcome.template} are not valid YAML once its variables are filled in. Only its body was inserted.`,
    );
  }
  return messages;
}
