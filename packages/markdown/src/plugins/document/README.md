# Document

Keep Markdown edits, saving and undo shared across editor panels. This replaces
Obsidian's file authority with VS Code's native TextDocument and history.

## How it works

The host retains one session per native document. It rebases incoming collaborative
edits, applies them through the workbench and broadcasts authoritative changes.
The webview connection buffers updates until CodeMirror attaches, owns input
grouping and synchronizes without keeping a second undo stack. Before flushing,
it runs strict draft commit participants; invalid drafts reject saving. Session
queues serialize edits and host actions, while logical grouping coordinates native
undo steps. All registrations and synchronizers follow their context/view lifetime.

If a panel receives updates against a version it never reached (a broadcast it
missed), it asks the host for the revision log from its own version (`catchUp`)
and applies it like any other update. Unsent local edits are rebased over it,
and edits the host already took are confirmed, never dropped or applied twice.

## Files

- `manifest.ts`: core plugin identity and runtime surfaces.
- `api.ts`: session, webview document, grouping and typed event contracts.
- `protocol.ts`: schemas for edit pushes, updates and flush requests.
- `host.ts`: shared session references and native change/save subscriptions.
- `session.ts`: authority, edit queues, broadcasting and native history actions.
- `save.ts`: native save completion and overlapping-save handling.
- `undo-groups.ts`: logical groups over native history fingerprints.
- `webview.ts`: connection service and update/flush registrations.
- `view-connection.ts`: buffered attachment, strict flush and synchronizer lifetime.
- `sync.ts`: CodeMirror collaborative send/receive and flush coordination.
- `input-annotation.ts`: shared webview edit-group annotation.
- `input-groups.ts`: plain typing, composition and Vim grouping boundaries.
- `input-groups.test.ts`: adjacency/timing/selection and explicit/remote boundaries.
- `flush.test.ts`: strict draft errors and participant removal.

## Services, events and settings

Host injects the host services `hostDocuments` and `hostCommands`, plus provides `documents`; webview injects `rpc` and
provides `document`. Host listens to `document/willSave`, emits
`document/changed` and serially dispatches `document/willSave` for native saves.
Webview emits `document/syncStatus`. This core plugin has no enablement switch
or separate settings.

## Limits and differences from Obsidian

The TextDocument owns saving, EOL and undo. Wire positions are LF-normalized
UTF-16 offsets. A view must attach before it can flush, and a stale/invalid
update is checked against native authority rather than overwriting the document.

`document/changed` also carries optional original-source native edits so marker
providers can preserve ranges between disjoint changes, including CRLF offsets.

A note with unsaved text whose file another program rewrites is not reloaded by
VS Code: it keeps the unsaved text and reports a conflict when saving. Hosts
that own the files merge instead, as Obsidian does: host-node's `NoteDocuments`
applies the outside change onto the unsaved text with `mergeDiskChange`
(`shared/document/merge.ts`), a line-based three-way merge. Where both changed
the same lines the unsaved lines stay; host-node first keeps the other
program's version in a conflict copy beside the note (`diskChangeConflicts`
says when) and tells the reader. The session only records the merged text as
the document's.
