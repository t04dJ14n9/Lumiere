# Missing `.md` open — skip Lumia reclaim (built-in Text Editor)

> Supersedes the untitled-bridge plan. **Product lock (金扬, Nov 4 2026):** missing `.md` stays in built-in Text Editor; existing files still reclaim to Lumia. Approach A untitled bridge abandoned.

**Goal:** Opening a missing `.md` path does not openWith Lumia / untitled bridge / FileNotFound from Lumia; existing notes still openWith Lumia.

**Architecture:** `isMarkdownAbsentOnDisk` gate in reclaim transfer `open()` — return early for absent `file:` Markdown paths. Remove MissingOpenBridge / Save swap from the hot path.

**Tech Stack:** Existing reclaim in `packages/markdown`.

## Global Constraints

- No workspace disk create on open.
- No Lumia openWith for missing paths.
- Worktree `/workspace/worktrees/lumiere-md-missing-open` on branch `fix/md-missing-open-untitled-bridge`.
- No new Cursor Cloud Agents. No VSIX rebuild in this task (parent).

## File map

- `packages/markdown/src/host/markdown-absent-on-disk.ts` — disk absence helpers (test override).
- `packages/markdown/src/host/reclaim-transfer.ts` — skip reclaim when absent.
- Removed: `missing-open-bridge.ts` untitled bridge / Save wiring.
- Tests: absent helpers + handoff-host missing→no openWith / existing→openWith.
- Spec: `docs/superpowers/specs/2026-11-04-md-missing-open-untitled-bridge-design.md`.

## Status

- [x] Skip missing paths in reclaim transfer.
- [x] Gut / remove MissingOpenBridge hot path.
- [x] Tests updated for product lock.
- [ ] Parent: VSIX + Host GUI verification.
