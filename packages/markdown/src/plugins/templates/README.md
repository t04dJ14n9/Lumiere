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
message names the note. Variables in the template's properties are filled
in as written when the YAML stays valid; otherwise each value holding one
is written quoted (`src/markdown/template-header.ts`). A template whose
properties are still not valid YAML gets only its body inserted, never its
`---` block, and the message names the template. A body inserted right
after a closing `---` with no line break gets one first.

Tokens: `{{title}}` (the destination note's basename), `{{date}}`,
`{{time}}`, and `{{date:FORMAT}}` / `{{time:FORMAT}}`. Formats are Moment.js
patterns in local time, written by `src/markdown/moment-format.ts` (shared
with Bases): years (`YYYY`, `YY`), quarters, months (`M`, `MM`, `MMM`,
`MMMM`, `Mo`), days (`D`, `DD`, `Do`, `DDD`, `DDDD`), weekdays (`d`, `dd`,
`ddd`, `dddd`, `E`), ISO weeks (`W`, `WW`, `GGGG`), hours (`H`, `HH`, `h`,
`hh`, `k`), `mm`, `ss`, fractions, `A`/`a`, offsets (`Z`, `ZZ`), `X`/`x`,
the English long formats (`L`, `LL`, `LT`, …) and `[literal text]`.

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

- Names are English whatever Obsidian's language. Locale weeks (`w`, `ww`,
  `gggg`), eras (`N`, `y`), time zone names (`z`) and six-digit years are
  not written: they are inserted as written and a message names them.
  `templates.json` formats carry over whatever their tokens.
- Works in Lumiere's editor only, not in VS Code's plain text editor.
- Inserting into a note with unsaved changes ends its current undo group,
  like other edits made by commands.
