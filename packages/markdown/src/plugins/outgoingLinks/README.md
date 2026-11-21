# Outgoing links

Shows the files the active note links to, its links whose note does not
exist yet, and (when expanded) other notes mentioned by name without a link.
This is Obsidian's **Outgoing links** core plugin.

## How it works

The view follows the active tab and reads the note's resolved and unresolved
links from the vault index, refreshing when indexing settles. Unlinked
mentions scan the active note's text for other notes' basenames and aliases
outside any link (same matcher as Backlinks), only when that section expands.
**Show More Context** (title toggle) surrounds each unlinked match with the
previous and next source lines.

## Files

- `host.ts`: the plugin: view, refresh, open, and create-unresolved commands.
- `tree.ts`: the view's tree for one note.
- Unlinked mention matching: `src/markdown/mentions.ts` (shared with Backlinks).
- `manifest.ts`: the view contribution.

## Services, events and settings

- Injects the host services `settings`, `hostCommands`, `views`, `activeEditor`
  and `navigation`, plus `vaults`. Listens to `vault/resolved`.
- Settings: `lumiere.markdown.plugins.outgoingLinks.enabled`;
  `lumiere.markdown.outgoingLinks.sortOrder` (default `alphabetical`);
  `lumiere.markdown.outgoingLinks.extraContext` (default `false`).

## Limits and differences from Obsidian

- Clicking a link not created yet creates and opens the note (same
  `navigation.resolve` path as Quick Switcher / in-note wiki create).
- File lists sort by file name or modified time (title-bar cycle), the
  orders of Obsidian's Backlinks view; Obsidian 1.15.0's Outgoing links view
  itself has no sort order or extra context (static read, 2026-11-21).
  Created-time sorts are omitted because the vault index
  stores mtime only. Unresolved linkpaths have no mtime and keep name order
  within modified-time modes.
- Unlinked mentions read the active note once per expand; very large vaults
  still walk every candidate basename (same cost class as Backlinks unlinked,
  but only one file body is read).
