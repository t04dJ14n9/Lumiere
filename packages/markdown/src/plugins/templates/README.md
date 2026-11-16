# Templates

**Insert Template** picks a note from your templates folder and inserts it at
the caret, filling in the date, the time and the note's title. Obsidian's
Templates core plugin.

## How it works

The command reads the active Lumiere editor's vault and its
`templates.*` settings (seeded from the vault's `.obsidian/templates.json`
by `obsidianCompat`), lists the Markdown files under the folder from the
vault index, and asks for one. It expands the chosen text with the shared
`expandTemplate` (`src/markdown/templates.ts`), then, inside the panel's
document action, flushes the webview, captures its selection, maps it to
source offsets and replaces it through `hostDocuments.apply`. The caret is
then moved after the inserted text.

A template with properties is merged as in Obsidian
(`src/markdown/template-insert.ts`): its properties join the note's, keeping
the note's values, adding missing keys and joining lists without
duplicates, through the YAML-safe property merge; only the body goes in at
the caret (below the properties when the caret is inside or above them).
A note without properties gets the template's block at its top. When the
note's properties are not valid YAML, only the body is inserted and a
message says so.

Tokens: `{{title}}` (the destination note's basename), `{{date}}`,
`{{time}}`, and `{{date:FORMAT}}` / `{{time:FORMAT}}`. Formats use the
tokens `YYYY`, `MM`, `DD`, `HH`, `mm` and `ss`, in local time, through the
Bases date formatter.

## Files

- `manifest.ts`: the command and the three settings.
- `host.ts`: the Insert Template command.
- `list.ts`: the folder setting, the template files and the picker rows.
- `insert.ts`: applies the template's edits at the panel's selection.

## Services, events and settings

- Injects the host services `hostCommands`, `hostDocuments`, `dialogs` and
  `settings`, plus `vaults` and `editors`. Provides nothing; no events.
- `lumiere.markdown.templates.folder` (empty: unset),
  `lumiere.markdown.templates.dateFormat` (`YYYY-MM-DD`),
  `lumiere.markdown.templates.timeFormat` (`HH:mm`),
  `lumiere.markdown.plugins.templates.enabled` (true).

## Limits and differences from Obsidian

- Only Moment's `YYYY`, `MM`, `DD`, `HH`, `mm` and `ss` are understood; other
  letters (`ddd`, `Do`, `[text]`) are written as they are. An Obsidian
  format with other tokens is not carried over from `templates.json`.
- Works in Lumiere's editor only, not in VS Code's plain text editor.
- Inserting into a note with unsaved changes ends its current undo group,
  like other edits made by commands.
