# Attachments

Obsidian-style attachment saving: drop or paste an image (including clipboard
screenshots and images in rich HTML paste) into a note → the file lands in
`files.attachmentFolder` under a `YYYY-MM-DD HH.mm.ext` name → the note gets a
relative Markdown or WikiLink embed from the Links settings.

## How it works

Shared helpers in `src/attachments/` resolve the folder, pick a unique
timestamp name, write bytes, and build the embed. The write only creates
(`workspace.files.createBytes` / `createText`): when another file took the
name after the folder was listed, it moves on to the next free name rather
than replace that file. The host half answers each note page's `save` (bytes)
and `importUrl` (http(s) / file://) RPCs; a `file://` source is read only from
inside a workspace folder or the note's vault (`local-source.ts`). The webview
half handles drag-and-drop, binary image paste, and rewrites remote / data-URI
images after HTML→Markdown paste.

Drag-and-drop listens on the webview document (capture) and always
`preventDefault`s file / uri-list drags so VS Code does not open the drop as a
tab when the webview actually receives the event (OS drops; Explorer drops
while holding Shift). Explorer drops that only carry URIs are imported on the
host; OS `File` drops are read in the webview. A web address is imported only
when it is an image's: an image dragged from a page (named by the dragged
`<img>`) or an address whose path ends in an image extension. A link dragged
from a browser is inserted as its text, as any dragged text is. Remote HTML images are
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

### Delete attachments when deleting files

Obsidian's setting of that name, `attachments.deleteUnlinkedAttachments`
(`ask`, `always` or `never`; default `ask`). When notes are deleted in VS Code
(the Explorer, or a workspace edit), the plugin finds the attachments only
those notes linked (`unlinked.ts`): files they link or embed that are not
notes, canvases or bases (Obsidian's rule), that no other note links to, and
that are not being deleted with them. `never` stops there, before the index is
read. The files are found while the notes still exist, through the host
service `hostDocuments.onWillDelete`, whose listener returns what to do once
they are gone (`delete-unlinked.ts`). `always` then moves each attachment to
the trash, through `workspace.files.remove` with `trash`, which honours VS
Code's `files.enableTrash`. `ask` first asks "Delete N attachments that no
other note uses?" listing their paths: Delete, Always Delete and Never Delete
(the last two also write the setting, as link updates' Always Update does);
Cancel keeps them and asks again next time. A file that cannot be deleted is
reported and the rest still go.

### Download Attachments for Current File

Obsidian's command of the same name. It finds the note's Markdown images
whose source is `http(s):` or a `data:` URI (`src/attachments/download.ts`;
images in code and wikilink embeds are skipped) and the image URLs in its
properties, lists them in a checklist with every row ticked (`dialogs.pickMany`;
each row shows the file name, the host and the URL) for the reader to untick
some, then downloads each ticked URL once on the host and saves it in `files.attachmentFolder` under the
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
A property counts when its value, or an item of its list, is one `http(s):` URL
whose path ends in an image extension (nothing is fetched to find out). It is
rewritten where it stands, through the properties module's YAML edits
(`mapPropertyStrings`), as a `[[…]]` link in the value's own quoting; comments,
other values and the list's style stay as they were. Obsidian writes a wikilink
here whatever the Links settings say, and so do we. A value YAML cannot rewrite
in place (block scalar, anchor, alias, tag, or nested below the top
level) is left alone.
Every web download is limited (`src/attachments/guarded-download.ts`): 30
seconds in all, 50 MB (a stream is cancelled where it crosses the limit), and at
most five redirects, followed by hand so that the first address and every hop
are checked before they are requested. Loopback, link-local, private-network
and other non-routable addresses are refused (`localhost`, `127.0.0.0/8`,
`10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `100.64/10`, IPv6 `::1`,
`fc00::/7`, `fe80::/10`, IPv4-mapped forms, and the `.local`, `.internal` and
`.home.arpa` names), as is a redirect to anything but `http(s)`. A refused or
oversized download counts as one that could not be downloaded. The same limits
apply to a remote image in pasted HTML; the page waits for each such image as
long as the host may take to download and save it (45 seconds), and one that
fails keeps its link while the others are still embedded. In an untrusted
workspace the host downloads nothing for a page (a pasted or dropped web
image keeps its link, with a short error), as other plugins reach the network
only in a trusted one; dropped files and `file:` images inside the workspace
are still saved.
If the note was closed before that edit, the files stay in the vault and the
dialog says the note was not changed.

## Files

- `manifest.ts`: feature switch and the Download command.
- `protocol.ts`: webview → host `save` / `importUrl` requests and the `refused` notice for a file the page did not send.
- `host.ts`: write into the vault; bind each open note page; opt into Explorer
  reclaim when the adapter offers it (no `vscode` import).
- `target.ts`: a note's attachment folder and link settings.
- `download-command.ts`: Download Attachments for Current File.
- `host-fetch.ts`: the host's `fetch`, handed to the downloader.
- `local-source.ts`: reads a `file:` source the page named, inside the
  workspace only.
- `unlinked.ts`: the attachments only some notes link to (pure, on the index).
- `delete-unlinked.ts`: the offer to delete them when those notes are deleted.
- `webview.ts`: DnD, clipboard image paste, HTML image rewrite.
- `drop-save.ts`: saves dropped items one by one; one that fails or is too large is reported and the rest go on.

## Services, commands and settings

Injects `editors`, `vaults`, `workspace`, `settings`, `dialogs`,
`hostDocuments` and `hostCommands`; optionally `customEditors`. Command:
`lumiere.markdown.downloadAttachments`, in a Lumiere note.
Setting: `attachments.deleteUnlinkedAttachments` (ask).

Folder: `files.attachmentFolder` (Links). Links: `links.useWikilinks` and
`links.newLinkFormat`. No filename-template setting in v1.

## Limits

A failed save leaves that item unchanged and shows a short error; no broken
vault link is inserted. Other items in a multi-drop are still saved. A dropped
or pasted file larger than 15 MB (what a page can send the host) is refused
before it is read, with a message naming it. An
attachment folder that is a symbolic link, or sits behind one, is not written
to: a link could lead out of the vault, so that save fails the same way.

A name that resolves to a private address is not caught: only the address as
written, and each redirect's, is checked, since there is no DNS answer to look
at (`http://127.0.0.1.nip.io/` passes), and a name could change address between
the check and the request. Where a browser hides a redirect from `fetch` (a
host whose fetch runs in a page rather than in Node; none on `main`), the URL
is fetched once more for the browser to follow, and
only the address it ended at is checked, after the request; the browser's CORS
and private-network rules stand in for the rest.

An image in pasted HTML whose `src` is a `file://` path outside the workspace
(Word and Pages paste such temporary files) is not imported: the page asking
for it is untrusted, and the path could name any image on the disk. An Explorer
or `code image.png` open that the reader confirms with Add to Note is
unaffected.

Delete attachments when deleting files differs from Obsidian's: only VS Code's
own deletions are seen (a note removed by another program, a Git checkout or
`workspace.fs` is not), a deleted folder offers nothing (Obsidian offers only
for a single file as well), a vault Lumiere has not indexed yet, or has not
finished parsing, offers nothing (an unparsed note could hide a link that still
uses an attachment), the question is one choice for all the attachments rather
than Obsidian's list with a checkbox each, and the trash is VS Code's
(`files.enableTrash`), not Obsidian's trash options. Links from canvases and
bases are not indexed, so an attachment only a canvas uses may be offered.
A host that does not report deletions hides the setting.

Single-click preview media while a Lumiere note is focused is left alone
(preview tabs are not offered). Any other pinned open of media in the note's
group (a double-click, Quick Open, `code image.png`, Explorer drop without
Shift) opens normally and shows the question; ignoring it keeps the image
open and the note unchanged. Open-to-the-side is left alone.

Download Attachments differs from Obsidian's: Obsidian shows a gallery of
thumbnails to untick; we show a checklist of file names, hosts and URLs, because
the host services draw no images (VS Code's multi-select quick pick; outside VS
Code, a checkbox list in the page). A host may show only the first 256 rows, so
a note with more than that offers the first 256 only. Read from Obsidian
1.15.0's code, the other differences are:

- A URL that serves no image is skipped here and named in the summary;
  Obsidian saves the answer as `Image.jpg`.
- A `Content-Disposition` name is read from `filename*=` too and from an
  `inline` disposition; Obsidian reads `filename=` of an `attachment` only.
- A property is taken when its path ends in an image extension and when it is
  a list item; Obsidian takes a string value whose whole URL ends in the
  extension (`cat.png?w=2` is not taken there) and no list items.
- A download stops at 30 seconds or 50 MB and never reaches a private address;
  Obsidian has no such limits.
