# Agent handoff format

Lumiere and Lumiere PDF both hand a selection to an agent with
**Copy Link for Agent**, and agents (and skills written for them) should read
one format. This file and `test/fixtures/agent-handoff-format.json` define it
once, for both products; each product's unit tests check its formatter
against the fixture.

Names are the same in both extensions: the plugin is `agentBridge`, the
service that builds and hands over the text is `AgentHandoff`, and the
command is `copyLinkForAgent`. The text is agent-agnostic plain text, in
the shape a selection takes in an agent chat: an `@` locator, a blank line,
the selection quoted with `> `, then a newline, so a paste leaves the caret
on a line of its own.

## Note selections (Markdown)

```text
@notes/a.md#12-18

> First selected line
>
> Third selected line
⏎
```

- The reference is `@` + path + `#` + line range; one line is `#12`.
- The path is relative to the only local workspace folder; in multi-root
  and remote workspaces it is the note's full URI
  (`@file:///elsewhere/b.md#1-2`).
- After a blank line comes the selection, every line quoted with `> `
  (an empty line is a bare `>`), line endings normalised to `\n` and
  trailing newlines dropped; the text ends with one `\n` (`⏎` above).
- Lumiere saves the note first, so the lines are those on disk.
  Lumiere PDF's MCP tool `get_current_note_selection` returns the same text for a
  note open in Lumiere; for an unsaved note, which has no stable
  line numbers, its reference reads `notes/a.md (unsaved, lines 12-18)`.

## PDF selections (Lumiere PDF)

```text
@papers/attention.pdf#page=3

> Scaled dot-product attention
⏎
```

- The locator is `@` + path + `#page=N`, one line per selected page; the
  path is percent-encoded where a raw character would end it (spaces,
  `#`, parentheses: `@papers/my%20paper.pdf#page=3`). A region adds
  `&viewrect=x,y,w,h` when regions are enabled. There is no `#:~:text=`:
  the quote carries the words. Never `#hl-`, never PDF++ `selection=`,
  never RFC `search=`.
- After a blank line comes the selected text, quoted as in note payloads,
  then one `\n`. A page-only copy (nothing selected) or a region with no
  text is the locator alone, then `\n`.
- The text is not a Markdown link: pasted into a note it is neither
  clickable nor indexed as a PDF backlink.
- No `Source:` / `Sources:` prefix, no PDF SHA-256 line, no cite
  instruction, and no region-image path on the clipboard. File revision
  hashing remains on the structured bridge envelope / MCP side when needed.
- In the UI, Copy Link for Agent is only on the PDF webview context menu.

## Changing the format

Change the fixture and this file in both repositories in the same change
set, update both formatters, and update the pinned hash in both tests.
