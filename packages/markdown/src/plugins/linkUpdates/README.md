# Link updates

When a note or attachment is renamed or moved in VS Code, rewrites the links
to it in other notes. This is Obsidian's **Automatically update internal
links** setting.

## How it works

Before VS Code renames files, the plugin waits (up to five seconds) for the
vault index to parse what is queued, finds every note that links to them
(through the vault index's backlinks), re-reads each note's current text and
rewrites only the path of each link: a wikilink stays a wikilink, a Markdown
link stays a Markdown link, and `#subpaths`, aliases, titles, `<…>`
destinations and a table row's escaped `\|` are kept. The path is written in
the new-link format. As in Obsidian, text that only showed the renamed file's
name follows it: a Markdown link's text equal to the note's name
(`[Old](Old.md)`) or to its path when that has folders, and a wikilink alias
equal to the name when the link has folders (`[[f/Old|Old]]`). A moved note's own path-style links are
rewritten too. Folder renames cover every file inside. By default it asks
first (Update Links, Always Update, which sets the mode to `always`, or
Don't Update), counting the notes from the index's parsed links so that
asking reads and rewrites nothing (unless a note is still unparsed, then
from the notes' current text), and builds the edits once, after the
answer, so text typed while the dialog is open is what gets rewritten. The edits are applied together
with the rename, so one undo reverts them.

When the rename finishes, each note is brought to the text planned for it and
saved if it had no unsaved changes. A note edited after the plan was made is
left as it is; one that cannot be opened, edited or saved is retried for 30
seconds. A message names the notes whose links were not updated, and one
failing note does not stop the others.

## Rename Heading

Rename Heading… renames the heading at the caret and updates the links to
it, as Obsidian's Rename heading does: each link whose single `#subpath`
names the heading (as links resolve, so case does not matter), in the note
and in every note linking to it, keeping its path, form and alias
(`heading-rename.ts`, `rename-heading.ts`). The note itself is edited first;
if it changed while the name was being asked for, nothing is renamed and the
command says so. A linking note that cannot be updated does not stop the
others; a message names it.

## Files

- `host.ts`: the rename hook, the prompt and folder expansion.
- `rewrite.ts`: the links a rename changes in one note, and their edits.
- `link-source.ts`: a link's source split around its path, and written back.
- `rename-label.ts`: the alias or link text that follows a rename.
- `manifest.ts`: the plugin's switch and `mode` setting.

## Services, events and settings

- Injects the host services `hostDocuments`, `dialogs` and `settings`, plus `vaults`.
- Settings: `lumiere.markdown.linkUpdates.mode` (`prompt`, `always`,
  `never`), `lumiere.markdown.links.newLinkFormat`.

## Limits and differences from Obsidian

- Only renames made in VS Code (Explorer, refactoring) are seen; a rename in
  another program looks like a delete and a create.
- Rename Heading asks for the new name in a prompt; Obsidian renames in
  its own prompt too. Nested subpaths (`#Parent#Heading`) are left, as in
  Obsidian.
