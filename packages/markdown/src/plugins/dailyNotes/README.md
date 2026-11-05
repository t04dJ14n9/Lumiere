# Daily Notes

**Open Today's Daily Note** opens the note named after today's date, creating
it from a template the first time. **Open Previous Daily Note** and **Open
Next Daily Note** step through the daily notes that exist. Obsidian's Daily
notes core plugin.

## How it works

Each command takes the active note's vault (else the workspace's) and reads
its `dailyNotes.*` settings, seeded from `.obsidian/daily-notes.json` by
`obsidianCompat`. Today's note is `folder/format(today).md` in local time;
a `/` in the format makes subfolders. When neither the vault index nor its
folder listing has it, the plugin creates the folders, reads the template,
expands it with `expandTemplate` (title: the file name; `{{date}}`: the
daily-note format) and writes the note, refusing paths through symbolic
links. Previous and next match vault paths against the format and open the
nearest earlier or later note, starting from the open daily note, or from
today when the open note is not one. Nothing opens on startup.

## Files

- `manifest.ts`: the three commands and settings.
- `host.ts`: the commands, the vault and its settings.
- `names.ts`: today's path, the template path, and ordering notes by date.
- `create.ts`: the existence check and writing a new note from the template.

## Services, events and settings

- Injects the host services `hostCommands`, `dialogs`, `settings`,
  `activeEditor` and `workspace`, plus `vaults`. Provides nothing; no events.
- `lumiere.markdown.dailyNotes.folder` (empty: the vault root),
  `lumiere.markdown.dailyNotes.dateFormat` (`YYYY-MM-DD`),
  `lumiere.markdown.dailyNotes.template` (empty: an empty note),
  `lumiere.markdown.plugins.dailyNotes.enabled` (true).

## Limits and differences from Obsidian

- Formats understand `YYYY`, `MM`, `DD`, `HH`, `mm` and `ss` only. An
  Obsidian format with other tokens (`dddd`, `Do`, `[W]ww`) is not carried
  over, since Lumia would name notes differently from the vault's.
- No "open daily note on startup", no ribbon button and no calendar.
- A date property does not link to its daily note.
- A missing template creates an empty note with a message, rather than no note.
