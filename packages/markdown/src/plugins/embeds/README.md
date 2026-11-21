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
A note, base or PDF embed far down a long rendered block loads only when it
comes near the screen (`near-viewport.ts`), so a block with many of them
renders the ones the reader can reach first.

A block embed (`![[Note#^id]]`) shows the block as Obsidian scopes it
(`src/markdown/metadata/block-extract.ts`): an id on a list item shows that
item with its bullet and children, an id inside a quote or callout shows the
whole quote, an id on a heading shows the heading line, and any other id
shows its paragraph, table or the block just above an id on its own line.
A nested item's children lose the item's indentation, counted in columns (a
tab reaches the next multiple of four), so they stay nested; a task ticked
in such an embed is matched to its source line ignoring that indentation.

As in Obsidian 1.12 and earlier (owner request 2026-11-21; 1.13 and later
keep images rendered), the caret or a selection touching an image shows its
source, with or without the editor's focus (as a link's; its inspector
takes the focus), by the rule other inline elements follow
(chains of abutting elements included), and the image stays drawn just after
it: below the source line when the embed is alone on its line, after any
list or quote marker (Live Preview's `editingPreview`, as display math),
inline after the source otherwise (a sentence, a task item) (`InlineContext.widgetAfter`, `image-reveal.ts`). The find bar's current
match inside its source, a selection, shows the source, as Obsidian's
search highlight does. An image has no Edit button.
Arrow keys move through a shown source as through a link's. A click selects
the image (as Obsidian 1.13), the caret at its start, so its source shows
too: nothing moves while the button is down (the reveal waits for the
release), and a block image is then scrolled back under the pointer
(`image-click-pin.ts`) so a double-click reaches it; an image in text
moves along its line, and the second press of a double-click that misses
it opens its inspector all the same (`image-double-press.ts`). It stays outlined. Then `+`/`=` and `-`
resize it in steps of 25 pixels, from the width it shows, up to the width of
the note's text and down to 20 pixels, as in Obsidian (written as `![[a.png|100]]`, or in a Markdown image's alt
text, `![100](a.png)`); `0` removes the size; Space opens the image
inspector (Obsidian lightbox); Enter selects the file name in its source,
and Tab the alias / size segment (as Obsidian's
`editSelectedImageAlias`); Backspace or Delete
removes the embed; Escape leaves source edit and re-selects the image
(Obsidian), or clears the outline; a click elsewhere or any edit also lets
it go (`image-selection.ts`, `image-size.ts`). While selected, the caret is hidden: the keys resize or edit the image rather than type. With Vim on, those keys still win: a capture-phase keydown runs them before `@replit/codemirror-vim`'s handler (BH-006).

## Files

- `manifest.ts`: enablement and Insert Embed contribution.
- `webview.ts`: renderer, post-processor and command registrations.
- `post-process.ts`: resource resolution, per-kind display and pass lifetime.
- `near-viewport.ts`: note, base and PDF embeds wait until they are within
  1,500 px of the editor scroller's visible area (an IntersectionObserver
  rooted at the scroller); images, media, web addresses, and embeds outside
  an editor scroller (hover previews) load at once.
- `embed-lives.ts`: what each embed of a pass holds (listeners, teardowns, the file it shows), released when it is shown again or the pass ends.
- `embed-lives.test.ts`: release order and lookup by file.
- `missing.ts`: the text an embed that cannot be shown says (`“x.png” could not be found.`, a missing heading, `failed to fetch image` for bytes that did not load, a circular or too deep embed).
- `stand-in.ts`: the `.file-embed` block that takes a failed Markdown `<img>`'s place, since an `<img>` shows no text.
- `resource-cache.ts`: what embeds resolved, so a block rendered again shows its files at once.
- `note.ts`: note/heading/block selection, ancestry and source-line mapping.
- `image.ts`: zoom toolbar, fit/actual sizing, pan and resize controls.
- `image-reveal.ts`: when an image's source shows, and the image drawn in its place or just after it.
- `image-selection.ts`: selecting an image by a click, and its keys.
- `image-anchor.ts`: which embed a rendered image shows, from where CodeMirror reports it (a block over its whole line or below it, an image in place of its source or after it, abutting images told apart).
- `image-click-pin.ts`: scrolls a clicked block image back under the pointer once its source shows above it; never against another scroll: it ends at the image's first drawing after the release, and corrects nothing once the note has scrolled since the press, whatever scrolled it.
- `image-double-press.ts`: a double-click whose second press misses the image the first selected (it moved) opens that image's inspector.
- `image-size.ts`: an image's written size and the resize steps.
- `estimated-height.ts`: CodeMirror height-map reserve for off-viewport remounts (inline embeds use `persistent` decorations so the reserve stays outside the viewport).
- `image-dialog.ts`: inspector dialog, remembered scale and focus lifetime.
- `image-selection-keys.ts`: maps a key press to a selected image's key (`+`, `-`, `0`, …).
- `image-resize-corner.ts`: the resize corner drawn on a selected image (visual only; resizing stays on the keys).
- `embed-actions.ts`: the `.embed-actions` bar around an image's inspect control.
- `clicks.ts`: what a click on an embed does: a note embed selects its source, an image leaves the caret alone.
- `pdf-documents.ts`: a PDF fetched and opened once for every embed that shows it; an embed's page turns.
- `pdf-engine.ts`: EmbedPDF's engine on the editor's thread, and a page rendered from an open document.
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
- `image-anchor.test.ts`: an image alone on a line with trailing spaces, and abutting images, are found where they are drawn; images in rendered callouts, tables and HTML blocks are not image embeds.
- `image-double-press.test.ts`: which second presses open the inspector.
- `image-click-pin.test.ts`: a clicked block image keeps its place once its source shows, an edit during the press included; `test/unit/embeds/image-reveal.test.ts`: reveal, placement, focus, chains, selections, the click's press, resizing and arrows with the source shown.
- `open-intent.test.ts`: wiki embeds carry `data-wiki`, Markdown images do not.
- `wide-block.test.ts`: image width and horizontal scrolling in Live Preview.
- `embeds.css`: embeds and the image inspector, bundled through
  `src/webview/styles/index.css`.

## Services, events and settings

Injects `editor`, `commands`, `livePreview`, `render`, `resources` and `rpc`;
provides no services. Listens to `render/postProcess`; to
`resources/changed`, which drops the resources it resolved; and to
`resources/found`, which loads again, in place, every embed that said its file
could not be found; and to `resources/modified`, which loads again, in place,
every embed showing a file that changed (what it showed stays until the new
version replaces it); no kernel events emitted.
Uses Links RPC to open an embedded target. `lumiere.markdown.plugins.embeds.enabled`
defaults to true. Insert Embed has no default keybinding. Remote media follows
workspace trust from Render. A link Online Videos draws as a tweet frame reserves the height that plugin claims through `render/claimedHeight` (none when the plugin is off or the workspace untrusted) so off-viewport remounts keep the frame's height, and an inline embed of such a link is drawn again when the claim changes. Any other remote link, a removed Online Videos site included, is a remote image: `failed to fetch image` when it is not one. Note embeds reserve a multi-paragraph floor and remember painted height across off-viewport remounts (`estimated-height.ts`).

## Limits and differences from Obsidian

Cycles and ancestry depth of twelve are refused, and the embed says which (“A” embeds
itself, so it is not shown again.); what Obsidian says is not measured. Local files remain host-contained;
remote media requires a trusted workspace. A PDF embed draws one page (`#page=`,
`#height=`) with page buttons rather than Obsidian's full PDF viewer (a
scrolling viewer with its toolbar inside the note); its Open
button opens the PDF in Lumiere PDF at that page, which is where the full
viewer is. The viewer is not embedded (DESIGN §1): it is Lumiere PDF's
React interface over PDFium in a worker, in its own editor; a note's page
allows no worker, and loading that interface into every note that embeds a
PDF would weigh on opening notes, which the quality budgets hold. Embeds of one PDF fetch
and open it once (`pdf-documents.ts`), and a page turn only renders the page
of that open document. The bytes go once the engine has opened them; the
document closes with the last embed of it. Rendering still runs in the
editor's own thread: its page allows no worker (no `worker-src`), so a large
page at a high zoom can hold up typing while it draws. WebM recovery supports VP8/VP9 and Opus/Vorbis when the host
MediaSource supports them. Visual and playback parity await owner comparison. Images show their source at the caret as Obsidian 1.12 did, not as 1.13+ (owner request 2026-11-21; docs/OBSIDIAN_REVEAL_RULES.md, "Intentional divergence: images"). The scroll that keeps a clicked block image under the pointer needs room to scroll, and may leave its source line above the top of the pane. Image embeds use Obsidian's `.embed-actions` frosted bar (inspect control; VS Code tokens).
