# Link updates

When a note or attachment is renamed or moved in VS Code, rewrites the links
to it in other notes. This is Obsidian's **Automatically update internal
links** setting.

## How it works

Before VS Code renames files, the plugin waits (up to five seconds) for the
vault index to parse what is queued, finds every note that links to them
(through the vault index's backlinks), re-reads each note's current text and
rewrites only the path of each link. A note the index has still not parsed
when the wait ends has no backlinks yet, so its text is read too. Every
`.canvas` file in the vault is read as well. Reading those files has one
20-second budget, shared by the prompt's count and the rewrite (which reuses
the count's reads), to stay inside VS Code's rename timeout; a message names
any file left unread, or that failed to read or parse, also when the prompt
is skipped because nothing else changes. In a canvas, a file
node's path follows the renamed file and a text node's Markdown links are
rewritten as a note's, from the canvas's path, and the canvas is written
back as Obsidian writes it (`JSON.stringify` with its own indentation). In
notes, a wikilink stays a wikilink, a Markdown
link stays a Markdown link, and `#subpaths`, aliases, titles, `<…>`
destinations and a table row's escaped `\|` are kept. A link in a property
value is escaped for the value's quoting (`'` doubled in single quotes, `"`
escaped in double quotes); a plain value that cannot hold the new name is
written double-quoted, so the note's YAML stays valid. The path is written in
the new-link format. As in Obsidian, text that only showed the renamed file's
name follows it: a Markdown link's text equal to the note's name
(`[Old](Old.md)`) or to its path when that has folders, and a wikilink alias
equal to the name when the link has folders (`[[f/Old|Old]]`). A moved note's own path-style links are
rewritten too. Folder renames cover every file inside. A link whose text
would come out the same (a note moved to another folder and linked by its
name) is neither counted in the prompt nor edited, so a move that changes no
link's text does not ask. By default it asks
first, matching Obsidian's `alwaysUpdateLinks: false` (Update Links, Always
Update or Don't Update). `always` rewrites without asking and `never` leaves
links untouched. Always Update updates the links now and saves `always` in
the note's workspace folder settings (the workspace's when the note is in no
folder), so it stays with that vault as Obsidian's `app.json` does and other
vaults still ask. If the save fails (a settings file with errors), the links
are still updated and an error says why. An explicit value wins over
`.obsidian/app.json`'s `alwaysUpdateLinks`, which the Obsidian compatibility
plugin reads (false is `prompt`, true is `always`) and Lumiere never writes.
It counts the notes from the index's parsed links so that asking reads and rewrites
nothing (unless a note is still unparsed, then from the notes' current text),
and builds the edits once, after the answer, so text typed while the dialog is
open is what gets rewritten. The edits are applied together with the rename, so
one undo reverts them.

Each file's edits carry the text they were computed from. When VS Code
runs the rename, a note whose text has changed since (typed in while the
prompt or the scan ran) gets no edits: line and column positions from the
old text would land in the wrong place. A warning names it.

When the rename finishes, each note is brought to the text planned for it and
saved if it had no unsaved changes. A note edited after the plan was made is
left as it is; one that cannot be opened, edited or saved is retried for 30
seconds. A message names the notes whose links were not updated, and one
failing note does not stop the others.

## Rename Heading

Rename Heading…, in the command palette and in the note's right-click menu
on a heading line (as in Obsidian's editor menu), renames the heading at the
caret and updates the links to it, as Obsidian's Rename heading does: each link whose single `#subpath`
names the heading (as links resolve, so case does not matter), in the note
and in every note linking to it, keeping its path, form and alias
(`heading-rename.ts`, `rename-heading.ts`). The note itself is edited first;
if it changed while the name was being asked for, nothing is renamed and the
command says so. As after a file rename, a linking note is saved if it had
no unsaved changes, and one that had is left unsaved. A linking note that
cannot be updated or saved does not stop the others; a message names it.

The heading gets the name as typed. Links get the heading's text as the
note's metadata reads it, which is what they resolve against: formatting is
dropped, so `New [[Target|Alias]]` gives `#New Alias` and `[Label](url)`
gives `Label` (`renamedHeadingFragment`). They get it as Obsidian writes a
subpath, with the characters a link cannot hold (`:`, `#`, `|`, `^`, `\`,
`%%`, `[[`, `]]`) as spaces, which still reach the heading since links
match headings with punctuation read as spaces (`headingSubpath`). A
Markdown link's destination also has `%`, and a space or parenthesis
(bare) or `<` and `>` (in `<…>`), percent-encoded so the link stays a link.

A name is refused, in the prompt, when a link written for it would not
reach the heading in the renamed note as links are followed
(`noteFragment`): nothing of its text is left for a link (`#|^`,
`![](a.png)`), it reads as a line range (`L12`), an earlier heading has
the same text as links compare it, or a `%` in it starts an escape
(`a%41b`).

## Files

- `host.ts`: the rename hook, the prompt and folder expansion.
- `rewrite.ts`: the links a rename changes in one note, and their edits.
- `canvas.ts`: a `.canvas` file's file nodes and text-node links after a
  rename.
- `yaml-safe-edits.ts`: link edits escaped for the property value around them.
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
- The default is Obsidian's: with `alwaysUpdateLinks: false` Obsidian asks
  too. The question is VS Code's dialog, with Update Links, Always Update and
  Don't Update where Obsidian has Always update, Just once and Do not update.
  Always Update is saved per workspace folder in VS Code's settings, where
  Obsidian's `alwaysUpdateLinks` is one vault setting in `.obsidian/app.json`.
- Rename Heading asks for the new name in a prompt; Obsidian renames in
  its own prompt too. Nested subpaths (`#Parent#Heading`) are left, as in
  Obsidian.
- Obsidian writes a Markdown link's new subpath with only spaces encoded,
  so a parenthesis or `%` in the name can break it there; Lumiere encodes
  them. Obsidian accepts a name with nothing left for a link and writes
  `[[Note#]]`; Lumiere refuses it.
- Obsidian writes a formatted name into links as typed
  (`#New Target Alias` for `New [[Target|Alias]]`); Lumiere's metadata
  reads a heading's text as shown (`New Alias`), so links get that. Obsidian also accepts a name that an
  earlier heading has, and its links then reach the earlier heading;
  Lumiere refuses the name.
