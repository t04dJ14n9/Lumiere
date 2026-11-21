# Quick switcher

**Lumiere: Quick Switcher** finds a note by name, alias or path and
opens it, or creates it when no note has that name. This is Obsidian's
**Quick switcher** core plugin.

## How it works

The command opens a quick pick over the active note's vault (or the first
workspace folder's). Each keystroke ranks notes, attachments (images, audio,
video, PDFs, canvases and bases, as Obsidian's default "Show attachments"),
notes' aliases and links whose note does not exist yet with Obsidian's
fuzzy scoring, accents folded as in 1.15.0 (`src/shared/fuzzy.ts`): a file matches on its name, or on its
path a point lower, and an excluded file ranks 10 points lower. An empty query
lists recently opened notes and attachments (mtime fallback for notes).
Choosing a missing note, or pressing Enter on a name no note has, creates it in
the new-note folder.

Obsidian's switcher keys work while the list is open: Mod+Enter opens the
choice in a tab of its own (one that stays open, as Obsidian's new tab),
Mod+Alt+Enter opens it to the side, Shift+Enter creates a note with the typed
name whatever row is selected, and Mod+Shift+Enter creates it in a tab of its
own. VS Code tells a quick pick nothing about the keys that accepted it, so
each is a key binding of its own, live only while the switcher is open
(`inQuickOpen` and the `lumiere.markdown.quickSwitcherOpen` context the
switcher sets): its command notes how to open, then accepts the selected row
(`accept.ts`).

## Files

- `host.ts`: the command, opening and creating.
- `accept.ts`: the modifier keys' commands and the context key that scopes
  them to the open switcher.
- `ranking.ts`: the ranked items for a query.
- `recent.ts`: workspace-scoped recently opened file URIs.
- `manifest.ts`: the command and the switcher keys' contributions.

## Services, events and settings

- Injects the host services `hostCommands`, `dialogs`, `activeEditor`, `settings` and `navigation`, plus `vaults`.
- Settings: `lumiere.markdown.plugins.quickSwitcher.enabled`,
  `lumiere.markdown.files.newNoteFolder`,
  `lumiere.markdown.vault.showUnsupportedFiles` (off: notes and the attachments
  Obsidian opens; on: every file of the vault, such as `.csv` or `.zip`).

## Limits and differences from Obsidian

- `vault.showUnsupportedFiles` is Obsidian's Show all file types, which also
  governs its File Explorer and link suggestions. Here it governs only this
  list: VS Code's Explorer is not Lumiere's to filter (`files.exclude` does it),
  and link suggestions already list every file, since VS Code opens most of them.
- The command has no key binding. Obsidian's Mod+O is VS Code's **Open
  File…** (Cmd+O on macOS, Ctrl+O elsewhere), a window-wide key; bound
  inside a note it would take Open File away there. No other key is
  Obsidian's, and VS Code's **Go to File…** (Mod+P) already finds files by
  name, so none is chosen for you. To have Obsidian's, add to
  `keybindings.json`:
  `{ "key": "ctrl+o", "mac": "cmd+o", "command": "lumiere.markdown.quickSwitcher", "when": "activeCustomEditorId == 'lumiere.markdown.editor'" }`.
- An empty query lists recently opened files (workspace storage), then falls
  back to recently modified for notes never opened here. Obsidian lists only
  recently opened files, attachments included; here an attachment counts as
  opened when it was opened from the switcher, since VS Code's image and PDF
  editors do not report opens to Lumiere.
- Bookmarks are not listed: Lumiere has no bookmarks (CAPABILITIES, "Not
  implemented"). Obsidian's switcher also finds bookmarked searches, graphs
  and URLs by their titles.
- Mod+Alt+Shift+Enter (Obsidian's open in a new window) is not bound. In
  host-node the switcher keys do nothing: they rely on VS Code's quick pick
  and context keys; Enter works there.
