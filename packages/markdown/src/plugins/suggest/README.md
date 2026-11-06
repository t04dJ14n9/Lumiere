# Suggestions

Completes note links, aliases, headings, block references and tags as you type,
corresponding to Obsidian's EditorSuggest lists.

## How it works

Links and Tags own trigger handlers on a typed bail event. The framework skips
literal code/frontmatter for links (tags still open there, as in Obsidian),
requests ranked candidates over validated RPC, and
installs CodeMirror completion keys in the suggestion priority slot. The host
caches candidates by file, invalidates on index changes, materializes only 50
link texts and honors source feature switches. Accepting a link reuses closing
brackets. Aborted requests and plugin disposal cancel pending work.

`[[Note#^` and `[[Note^` offer every block of the note, as Obsidian 1.14
does (`src/markdown/metadata/note-blocks.ts`): headings, paragraphs, each list
item, quotes and callouts, code, tables, math and footnote definitions. A
block without an id gets one when picked, six hex digits, as in Obsidian: after
a space at the end of a paragraph, list item or footnote, or on a line of its
own after any other block, in this note or in the other one (if the text
there has not changed).

`[[paper.pdf#` offers the PDF's bookmarks, as Obsidian offers a note's
headings. Picking one writes the page and its title:
`[[paper.pdf#page=5|Methods]]`, or `[Methods](paper.pdf#page=5)` with
`links.useWikilinks` off. Lumia and Lumia PDF already open `paper.pdf#page=5`
at that page. The bookmarks come from the injected `pdfOutlines` service;
before a bookmark list is ranked, `prepare()` asks for it, as it reads a note
for `[[Note#^`.

A source may instead return a list it makes itself (`LocalSuggestions`, the
highlight colours after `==`), shown without asking the host; Tab does not
take its entries, as in Obsidian. Each entry builds its acceptance transaction
from the current editor state, so it can replace surrounding text as well as
insert at the caret.

Ranking is Obsidian 1.14's: the fuzzy score of `src/shared/fuzzy.ts` (checked
against Obsidian's own on 2,463 query and text pairs). A note matches on its
name, or on its path a point lower; an excluded note is still offered, 10
points lower. Aliases, headings and unresolved links match their own text; a
tag matches lower-cased, from every tag path in the vault (parents too),
listed by name. A block matches when its text has every word of the query,
or its id does, which ranks first. Equal scores keep the vault's order. With
nothing typed, notes come most recently changed first.

## Files

- `api.ts`: caller-owned source registration and trigger event.
- `manifest.ts`: default enablement and surfaces.
- `protocol.ts`: bounded query and result schemas.
- `sources.ts`: indexed candidate groups and per-file cache invalidation.
- `candidates.ts`: metadata candidate construction, PDF bookmarks included.
- `insertion.ts`: deferred wiki/Markdown insertion and destination encoding.
- `rank.ts`: Obsidian's scoring and bounded best-50 selection.
- `host.ts`: per-panel RPC and source enablement checks.
- `completion.ts`: code/frontmatter gating (tags allowed) and insertion transaction.
- `webview.ts`: source service, asynchronous completion and key priority.
- `suggest.css`: the plugin's styles, bundled through `src/webview/styles/index.css`.

## Services, events and settings

Provides `suggest.register`; webview injects `editor` and `rpc`, host injects
`rpc`, `vault` and the host service `settings`, and optionally `vaults`,
`hostDocuments` and `pdfOutlines` (`src/shared/pdf-outlines.ts`: the
extension's root provides it from Lumia PDF; the editor host hands it to each
panel). Emits the `suggest/trigger` bail event; Links and
Tags listen independently. `lumiere.markdown.plugins.suggest.enabled` defaults
to true. No palette commands or assigned verify shortcuts.

## Limits and differences from Obsidian

At most 50 results. Equal scores keep the vault's order, which is by path
here and the order the files were loaded in Obsidian, so exact ties can list
differently. First candidate construction can exceed a frame on large vaults;
warm queries reuse cached candidates. Existing indexed metadata can lag typing by the indexer's
refresh interval. The popup uses CodeMirror's UI. A vault-wide block search
(`[[^^`) offers blocks with an id only.

PDF bookmarks are listed flat, in document order, without their nesting, and
only those that open a page of the PDF itself. They exist only where a PDF
engine does: in VS Code and Cursor. Elsewhere (the web app, the iPad, DSH)
`[[paper.pdf#` offers nothing. Obsidian offers no PDF bookmarks; the
`#page=N|title` form is Lumia's.

With `links.useWikilinks` off, accepting a link/head/block completion replaces
the entire partial wiki token with a Markdown link. Existing `]]` are consumed.
Unresolved basename Markdown destinations (`Note`, `Note.md`) create missing
notes on click like wikilinks; relative paths (`./x`, `folder/x`) stay open-only
so source-relative lookup is preserved.

Tag suggestions open inside fenced/inline code and source-mode frontmatter
(Obsidian). Link, heading, block and local (highlight) lists stay blocked in
those regions.

