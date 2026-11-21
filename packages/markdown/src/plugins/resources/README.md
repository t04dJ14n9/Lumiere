# Resources

Loads local notes, images, audio, video and attachment cards used by embeds and
previews, corresponding to Obsidian's vault resource access.

## How it works

Each panel owns a set of known note sources and a validated resource RPC channel.
Targets resolve through the injected vault index; URI and realpath containment
are checked before reads. A Markdown link the index does not know is looked
for on disk where a click on it looks (`shared/link-location.ts`: a leading
`/` from the vault root, `./` and `../` from the note's folder, a bare name
beside the note and then at the vault root), so a link into a hidden folder
the index skips (`/.raw/captured/page.md`, `.hidden.md`) previews and embeds
the file a click opens: the click looks in the same places in the same order
whether or not it may make a note, and only a link that names no file makes
one. Notes use open-document text when available, preserving
unsaved edits. Successfully loaded notes become authorized sources for nested
requests. Webview URLs include modification time for cache invalidation.
The webview keeps resolved media, not note text; loads of one file that
overlap (`![[Big#A]]`, `![[Big#B]]` and a hover preview of Big) share one
request.
A link whose file the vault does not have is remembered; when the index lists
it later (a file created or renamed into place, or found while the index
catches up), the host tells the page, so its embed shows the file as in
Obsidian instead of saying it could not be found until the note is reopened.
The host also remembers the files each page loaded (the latest 1,024). When
the index says one was rewritten (on disk, or as unsaved text in another
editor), moved or removed, it tells the page, gathering a burst of changes
into one notice within 100 ms, so its embeds show the new version.

A `.base` embed needs every note's properties, tags, links and backlinks.
The host keeps one snapshot of them per panel, built again only after the
index changed (any change, or a resolve after silent updates and settings).
Each base load says which version the page holds: the reply carries nothing
when that is current, only the entries that changed when it is the version
just before (the same notes in the same order), and every entry otherwise.
The page keeps its copy (`PageBaseSnapshot`) and hands each base embed the
whole list, so twenty base embeds in a note cost one snapshot, not twenty.

## Files

- `manifest.ts`: core plugin metadata and surfaces.
- `api.ts`: resource kind and service contracts.
- `protocol.ts`: load request/result schemas.
- `host.ts`: service and RPC registration.
- `diff-resources.ts`: independent diff-side resolution and Git revision selection.
- `note-resources.ts`: known-source authorization, target containment, contained reads, kind selection and missing links.
- `base-snapshot.ts`: the panel's snapshot of the notes for base embeds, and what a reply sends of it.
- `page-base-snapshot.ts`: the page's copy of that snapshot, completed from each reply.
- `containment.ts`: URI/realpath and virtual-symlink checks.
- `webview.ts`: validated resource RPC client.
- `note-resources.test.ts`: kind precedence, fallback and on-disk Markdown link units.

## Services, events and settings

Host injects `rpc`, the host services `hostDocuments`, `workspace` and `git`, plus `vault`; webview injects `rpc`. Provides
`resources` on both surfaces. Declares `resources/changed` (files a note shows
were rewritten): the webview drops its resolved URLs, whose `?v=` is the old
mtime. Declares `resources/found`, which the webview emits when the host's
`found` notice says a missing link resolves now; the host listens to the
index's `onDidChange` (create, rename) and `onDidResolve` for it. Declares
`resources/modified (sources)`, which the webview emits, after dropping its
resolved URLs, when the host's `changed` notice names files the page loaded
that the index's `onDidChange` (modify, rename, delete) reported. No commands
or direct user settings.
Vault configuration determines roots and resolution. The window service
`diffResources` injects `vaults` and the host services `hostDocuments`, `workspace` and `git`, plus provides contained image
resolution for standalone diff panels.

## Limits and differences from Obsidian

Only contained vault links are loadable; external URLs and unknown source notes
are rejected. Obsidian does not resolve links into hidden folders at all;
Lumiere resolves Markdown links there, as its clicks do, but a wikilink only
through the index, and a file found on disk is not watched, so a page that
showed it is not told when it changes. Virtual filesystem symlinks are refused. Notes use the `.md`
extension for resource classification. Host authorization is rechecked before
embedded edits by consuming plugins.
