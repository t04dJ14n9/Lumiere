import type {
  ContributedSetting,
  Dialogs,
  SettingsAccess,
  SettingTarget,
} from "../../shared/host";
import {
  checkNumberText,
  editKind,
  validateValue,
} from "../../shared/setting-schema";
import { PREFIX, relativeKey } from "./change";
import { t } from "@workshop/l10n";

/** Where a setting was written, for the confirmation. */
export function where(target: SettingTarget): string {
  switch (target) {
    case "workspaceFolder":
      return t("folder settings");
    case "workspace":
      return t("workspace settings");
    case "user":
      return t("user settings");
  }
}

/** What editing a setting needs from the window. */
export interface Editing {
  settings: SettingsAccess;
  dialogs: Pick<Dialogs, "pick" | "input">;
  /** The note whose folder scope applies, if one is open. */
  resource(): string | undefined;
  inform(message: string): void;
  error(message: string): void;
}

/**
 * The extension's own setting for a key, from its contributed schema, or
 * undefined: unknown keys, other extensions' keys and keys outside the
 * namespace never match, whatever a caller passes.
 */
export function ownSetting(
  editing: Editing,
  key: unknown,
): ContributedSetting | undefined {
  if (typeof key !== "string" || !key.startsWith(PREFIX)) {
    return undefined;
  }
  return editing.settings.contributed().find((setting) => setting.key === key);
}

/**
 * The only way a command changes a setting: the key must be one of ours, the
 * value must pass the schema, and it goes where the Settings UI would put it.
 * Returns whether it was written.
 */
export async function writeSetting(
  editing: Editing,
  setting: ContributedSetting,
  value: unknown,
  describe?: string,
): Promise<boolean> {
  const key = relativeKey(setting.key);
  const problem = validateValue(setting.schema, value);
  if (problem) {
    editing.error(t("Not changed: {0}. {1}", key, problem));
    return false;
  }
  const target = await editing.settings.update(key, value, editing.resource());
  editing.inform(
    describe
      ? t("{0} ({1})", describe, where(target))
      : t("{0} set to {1} ({2})", key, JSON.stringify(value), where(target)),
  );
  return true;
}

/** Edits one setting by its type; the value goes where the Settings UI would put it. */
export async function editSetting(
  editing: Editing,
  setting: ContributedSetting,
): Promise<void> {
  const key = relativeKey(setting.key);
  const current = editing.settings.inspect(key, editing.resource()).value;
  const write = (value: unknown) => writeSetting(editing, setting, value);
  switch (editKind(setting.schema)) {
    case "boolean":
      await write(!(typeof current === "boolean" ? current : false));
      return;
    case "enum":
      return editChoice(editing, setting, current, write);
    case "number":
    case "integer":
      return editNumber(editing, setting, current, write);
    case "string":
      return editText(editing, key, current, write);
    default:
      // Lists and objects are edited where VS Code edits them.
      return editing.settings.openUi(`@id:${setting.key}`);
  }
}

type Write = (value: unknown) => Promise<boolean>;

async function editChoice(
  editing: Editing,
  setting: ContributedSetting,
  current: unknown,
  write: Write,
): Promise<void> {
  const { schema } = setting;
  const values = schema.enum ?? [];
  const picked = await editing.dialogs.pick({
    placeholder: relativeKey(setting.key),
    items: (query) =>
      values
        .map((value, index) => ({
          label: String(value),
          description: value === current ? t("current") : "",
          detail: schema.enumDescriptions?.[index] ?? "",
          value,
        }))
        .filter((item) =>
          item.label.toLowerCase().includes(query.trim().toLowerCase()),
        ),
  });
  if (picked?.item) {
    await write(picked.item.value);
  }
}

/** The prompt for a number setting, filled with its current value when that is a number. */
export function askNumber(
  editing: Editing,
  setting: ContributedSetting,
  current: unknown,
  prompt: string,
): Promise<string | undefined> {
  return editing.dialogs.input({
    prompt,
    value: typeof current === "number" ? String(current) : "",
    validate: (text) => checkNumberText(text, setting.schema),
  });
}

async function editNumber(
  editing: Editing,
  setting: ContributedSetting,
  current: unknown,
  write: Write,
): Promise<void> {
  const { schema } = setting;
  const key = relativeKey(setting.key);
  const prompt =
    typeof schema.minimum === "number" && typeof schema.maximum === "number"
      ? t("{0} ({1} to {2})", key, schema.minimum, schema.maximum)
      : key;
  const typed = await askNumber(editing, setting, current, prompt);
  if (typed !== undefined) {
    await write(Number(typed.trim()));
  }
}

async function editText(
  editing: Editing,
  key: string,
  current: unknown,
  write: Write,
): Promise<void> {
  const typed = await editing.dialogs.input({
    prompt: key,
    value: typeof current === "string" ? current : "",
    validate: () => undefined,
  });
  if (typed !== undefined) {
    await write(typed);
  }
}
