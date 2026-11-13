# Attachments

Obsidian-style attachment saving: drop or paste an image (including clipboard
screenshots and images in rich HTML paste) into a note → the file lands in
`files.attachmentFolder` under a `YYYY-MM-DD HH.mm.ext` name → the note gets a
relative Markdown or WikiLink embed from the Links settings.

## How it works

Shared helpers in `src/attachments/` resolve the folder, pick a unique
timestamp name, write bytes, and build the embed. The host half answers each
note page's `save` (bytes) and `importUrl` (http(s) / file://) RPCs. The
webview half handles drag-and-drop, binary image paste, and rewrites remote /
data-URI images after HTML→Markdown paste.

Drag-and-drop listens on the webview document (capture) and always
`preventDefault`s file / uri-list drags so VS Code does not open the drop as a
tab when the webview actually receives the event (OS drops; Explorer drops
while holding Shift). Explorer drops that only carry URIs are imported on the
host; OS `File` drops are read in the webview. Remote HTML images are
downloaded on the host because the editor CSP `connect-src` does not allow
`https:`.

### Explorer without Shift

VS Code disables pointer events on custom-editor webviews while Explorer
resources are dragged unless Shift is held, so the workbench opens the file as
a pinned tab (`EditorDropTarget` forces `pinned: true`) instead of delivering
`drop` to the page. There is no extension API to intercept those drops on the
webview; the VS Code adapter watches pinned media tab opens instead (see
`src/host/attachments-explorer-reclaim.ts`, wired through
`customEditors.registerExplorerAttachmentReclaim`): when the prior active
editor in that column was a Lumiere note that is still open, it asks
"Add image.png to note.md as an attachment?" and leaves the media tab open.
Only **Add to Note** closes the tab, copies the file into
`files.attachmentFolder` under a timestamp name, and inserts the embed. Such an
open looks exactly like `code image.png` in a terminal, Quick Open or a
double-click, which used to be inserted into the note without asking.
Portable hosts omit the hook.

Sketch placement uses the same shared helpers, so sketches and pasted images
share one folder and link story.

### Download Attachments for Current File

Obsidian's command of the same name. It finds the note's Markdown images
whose source is `http(s):` or a `data:` URI (`src/attachments/download.ts`;
images in code and wikilink embeds are skipped), asks once, then downloads
each URL once on the host and saves it in `files.attachmentFolder` under the
file name the server gives in `Content-Disposition` (`filename*=` first, then
`filename=`), else the name at the end of its URL (`cat.png`, then `cat 1.png`
when taken; `Image` for a data URI or a URL without a file name). A served name
is cut to its base name, loses control characters and what breaks a link, and
keeps its extension only when that is an image's; anything else is saved under
the extension the response implies, so a server cannot choose a `.php`. Each
image becomes an embed in the Links format that keeps its alt text
(`![[cat.png|A cat]]`), found again in the note as it is after the downloads,
in one edit. Only what is served as
an image is saved: a response whose `Content-Type` is not `image/*` is skipped
and its link stays, and when the type is missing or `application/octet-stream`
the first bytes decide (PNG, JPEG, GIF, WebP, AVIF, BMP, SVG). A data URI is
saved only when it says `image/…`, in base64 or percent-encoded
(`image/svg+xml,%3Csvg…`): a note's links can point anywhere. The closing
message counts the skipped URLs and names the first three.
If the note was closed before that edit, the files stay in the vault and the
dialog says the note was not changed.

## Files

- `manifest.ts`: feature switch and the Download command.
- `protocol.ts`: webview → host `save` / `importUrl` requests.
- `host.ts`: write into the vault; bind each open note page; opt into Explorer
  reclaim when the adapter offers it (no `vscode` import).
- `target.ts`: a note's attachment folder and link settings.
- `download-command.ts`: Download Attachments for Current File.
- `webview.ts`: DnD, clipboard image paste, HTML image rewrite.

## Services, commands and settings

Injects `editors`, `vaults`, `workspace`, `settings`, `dialogs`,
`hostDocuments` and `hostCommands`; optionally `customEditors`. Command:
`lumiere.markdown.downloadAttachments`, in a Lumiere note.

Folder: `files.attachmentFolder` (Links). Links: `links.useWikilinks` and
`links.newLinkFormat`. No filename-template setting in v1.

## Limits

A failed save leaves that item unchanged and shows a short error; no broken
vault link is inserted. Other items in a multi-drop may still succeed. An
attachment folder that is a symbolic link, or sits behind one, is not written
to: a link could lead out of the vault, so that save fails the same way.

Single-click preview media while a Lumiere note is focused is left alone
(preview tabs are not offered). Any other pinned open of media in the note's
group (a double-click, Quick Open, `code image.png`, Explorer drop without
Shift) opens normally and shows the question; ignoring it keeps the image
open and the note unchanged. Open-to-the-side is left alone.

Download Attachments differs from Obsidian's: it asks once for all the images
(Obsidian shows a gallery to untick some); it does not download image URLs
in properties (Obsidian turns those into `[[…]]`).
