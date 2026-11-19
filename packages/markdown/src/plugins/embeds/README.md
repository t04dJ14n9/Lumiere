# Embeds

Transcludes notes, headings and block IDs and displays images, audio and video,
like Obsidian's embeds. A PDF shows one page inline; other attachments appear as
cards that open files.

## How it works

Inline/block renderers use shared rendering, then each embed pass resolves its
placeholders through Resources. Note renders retain the native source identity,
full text and line offsets for links/tasks/footnotes. Media controls, image dialogs,
recovery streams and nested passes are disposed when the owning pass or plugin
stops. Original placeholders are restored and late resource results are ignored.

A block embed (`![[Note#^id]]`) shows the block as Obsidian scopes it
(`src/markdown/metadata/block-extract.ts`): an id on a list item shows that
item with its bullet and children, an id inside a quote or callout shows the
whole quote, an id on a heading shows the heading line, and any other id
shows its paragraph, table or the block just above an id on its own line.
A nested item's children lose the item's indentation, counted in columns (a
tab reaches the next multiple of four), so they stay nested; a task ticked
in such an embed is matched to its source line ignoring that indentation.

As in Obsidian 1.13 and later, an image stays rendered whatever the caret or
a selection does, and has no Edit button. A click selects it, and so does
ArrowRight with the caret just before it or ArrowLeft just after it (the
next press moves past): it stays outlined. Then `+`/`=` and `-`
resize it in steps of 25 pixels, from the width it shows, up to the width of
the note's text (written as `![[a.png|100]]`, or in a Markdown image's alt
text, `![100](a.png)`); `0` removes the size; Space opens the image
inspector (Obsidian lightbox); Enter shows its source with the file name
selected, and Tab with the alias / size segment selected (as Obsidian's
`editSelectedImageAlias`), until the caret leaves it; Backspace or Delete
removes the embed; Escape leaves source edit and re-selects the image
(Obsidian), or clears the outline; a click elsewhere or any edit also lets
it go (`image-selection.ts`, `image-size.ts`). While selected, the caret is hidden so a tall `|W` height reserve cannot paint a bar below the card. With Vim on, those keys still win: a capture-phase keydown runs them before `@replit/codemirror-vim`'s handler (BH-006).

## Files

- `manifest.ts`: enablement and Insert Embed contribution.
- `webview.ts`: renderer, post-processor and command registrations.
- `post-process.ts`: resource resolution, per-kind display and pass lifetime.
- `embed-lives.ts`: what each embed of a pass holds (listeners, teardowns, the file it shows), released when it is shown again or the pass ends.
- `embed-lives.test.ts`: release order and lookup by file.
- `missing.ts`: the text an embed that cannot be shown says (`“x.png” could not be found.`, a missing heading, `failed to fetch image` for bytes that did not load).
- `stand-in.ts`: the `.file-embed` block that takes a failed Markdown `<img>`'s place, since an `<img>` shows no text.
- `resource-cache.ts`: what embeds resolved, so a block rendered again shows its files at once.
- `note.ts`: note/heading/block selection, ancestry and source-line mapping.
- `image.ts`: zoom toolbar, fit/actual sizing, pan and resize controls.
- `image-selection.ts`: selecting an image by a click, and its keys.
- `image-size.ts`: an image's written size and the resize steps.
- `estimated-height.ts`: CodeMirror height-map reserve for off-viewport remounts (inline embeds use `persistent` decorations so the reserve stays outside the viewport).
- `image-dialog.ts`: inspector dialog, remembered scale and focus lifetime.
- `image-selection-keys.ts`: maps a key press to a selected image's key (`+`, `-`, `0`, …).
- `image-resize-corner.ts`: the resize corner drawn on a selected image (visual only; resizing stays on the keys).
- `embed-actions.ts`: the `.embed-actions` bar around an image's inspect control.
- `clicks.ts`: what a click on an embed does: a note embed selects its source, an image leaves the caret alone.
- `pdf-embed.ts`: the inline PDF viewer (`#page=` and `#height=` subpaths, page rendering through EmbedPDF, the Open button).
- `base-embed.ts`: renders an embedded `.base` file's selected view (table, cards or list).
- `base-embed-views.ts`: the cards and list views, cell values and note links for base embeds.
- `webm.ts`: WebM parsing/recovery exports.
- `webm-stream.ts`: EBML metadata, streaming boundaries and block time ordering.
- `media-recovery.ts`: recovery fetch, header identification and streaming lifetime.
- `media-source.ts`: MediaSource opening, append cleanup and Opus-preroll start.
- `note.test.ts`: fragment, source-offset and circular-embed units.
- `image.test.ts`: saved-scale validation and legacy state units.
- `webm.test.ts`: real codec fixtures, stream ordering and invalid/truncated data.
- `estimated-height.test.ts`: height reserves for sized, unsized and note embeds.
- `missing.test.ts`: the text shown for missing files, headings and blocks.
- `image-selection-keys.test.ts`, `image-resize-corner.test.ts`, `embed-actions.test.ts`: selected-image keys and chrome.
- `open-intent.test.ts`: wiki embeds carry `data-wiki`, Markdown images do not.
- `wide-block.test.ts`: image width and horizontal scrolling in Live Preview.
- `embeds.css`: embeds and the image inspector, bundled through
  `src/webview/styles/index.css`.

## Services, events and settings

Injects `editor`, `commands`, `livePreview`, `render`, `resources` and `rpc`;
provides no services. Listens to `render/postProcess`; to
`resources/changed`, which drops the resources it resolved; and to
`resources/found`, which loads again, in place, every embed that said its file
could not be found; no kernel events emitted.
Uses Links RPC to open an embedded target. `lumiere.markdown.plugins.embeds.enabled`
defaults to true. Insert Embed has no default keybinding. Remote media follows
workspace trust from Render. YouTube/Bilibili image links share the EmbedBlock height reserve via Online Videos `api` (`parseVideoUrl`) so off-viewport remounts keep card height. Note embeds reserve a multi-paragraph floor and remember painted height across off-viewport remounts (`estimated-height.ts`).

## Limits and differences from Obsidian

Cycles and ancestry depth of twelve are refused. Local files remain host-contained;
remote media requires a trusted workspace. A PDF embed draws one page (`#page=`,
`#height=`) with page buttons rather than Obsidian's full PDF viewer; its Open
button opens the PDF in Lumiere PDF at that page. WebM recovery supports VP8/VP9 and Opus/Vorbis when the host
MediaSource supports them. Visual and playback parity await owner comparison. Image embeds use Obsidian's `.embed-actions` frosted bar (inspect control; VS Code tokens).
