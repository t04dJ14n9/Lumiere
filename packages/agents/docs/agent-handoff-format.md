# Agent handoff format

Lumia and Lumia PDF both hand a selection to an agent with
**Copy Link for Agent**, and agents (and skills written for them) should read
one format. This file and `test/fixtures/agent-handoff-format.json` define it
once, for both products; each product's unit tests check its formatter
against the fixture.

Names are the same in both extensions: the plugin is `agentBridge`, the
service that builds and hands over the text is `AgentHandoff`, and the
command is `copyLinkForAgent`. The text is agent-agnostic: plain text with
raw links, never a chat-specific mention syntax.

## Note selections (Markdown)

```text
@notes/a.md#12-18

> First selected line
>
> Third selected line
```

- The reference is `@` + path + `#` + line range; one line is `#12`.
- The path is relative to the only local workspace folder; in multi-root
  and remote workspaces it is the note's full URI
  (`@file:///elsewhere/b.md#1-2`).
- After a blank line comes the selection, every line quoted with `> `
  (an empty line is a bare `>`), line endings normalised to `\n` and
  trailing newlines dropped.
- Lumia saves the note first, so the lines are those on disk.
  Lumia PDF's MCP tool `get_current_note_selection` returns the same text for a
  note open in Lumia; for an unsaved note, which has no stable
  line numbers, its reference reads `notes/a.md (unsaved, lines 12-18)`.

## PDF selections (Lumia PDF)

```text
> Scaled dot-product attention
>
> [attention.pdf · p.3](papers/attention.pdf#page=3#:~:text=Scaled%20dot%2Dproduct%20attention)
```

- Quote-first: the selected text is quoted with `> ` (same rules as note
  payloads), then a blank quoted line (`>`), then one Markdown link per
  selected page as a quoted line. A page-only or empty-region copy is
  link-only (no quote block).
- Label is `basename · p.N` (no escapes). Href is Chrome-aligned:
  `path#page=N` alone, or `path#page=N#:~:text=…` when there is selected
  text, or `path#page=N&viewrect=x,y,w,h` when regions are enabled (no
  angle brackets around the href). Never `#hl-`, never PDF++ `selection=`,
  never RFC `search=`.
- No `Source:` / `Sources:` prefix, no PDF SHA-256 line, no cite
  instruction, and no region-image path on the clipboard. File revision
  hashing remains on the structured bridge envelope / MCP side when needed.
- In the UI, Copy Link for Agent is only on the PDF webview context menu.

## Changing the format

Change the fixture and this file in both repositories in the same change
set, update both formatters, and update the pinned hash in both tests.
