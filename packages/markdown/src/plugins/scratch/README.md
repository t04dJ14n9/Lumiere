# Scratch

Creates temporary notes in a scratch folder. Nothing is filed or ingested on its own.

## How it works

New Scratch Note asks for a title and writes `YYYY-MM-DD-title.md`, dated by the local day as daily notes are, in `lumiere.markdown.scratch.folder` inside the first workspace folder. The folder is created then. The note has `title` and `captured` frontmatter. A path that leaves the project or follows a symbolic link is refused.

## Files

- `host.ts`: the command.
- `run.ts`: create, including symlink checks.
- `template.ts`: scratch text and the file-name slug.
- `names.ts`: file names.
- `manifest.ts`: the command and `scratch.folder`.

## Services, events and settings

- Requires the host services `hostCommands`, `dialogs`, `settings` and `workspace`.
- Does not provide a service.
- Setting: `lumiere.markdown.scratch.folder` (default `scratch`).
- Setting: `lumiere.markdown.plugins.scratch.enabled`.

## Limits and differences from Obsidian

- There is no daily note and no automatic filing.
