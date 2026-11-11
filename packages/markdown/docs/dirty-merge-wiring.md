# Dirty external merge — wiring still to do (issue #696)

`src/plugins/document/dirty-merge.ts` is the pure, unit-tested core of the P0
data-loss fix: `mergeExternalChange({ lastSaved, authority, hostText })` rebases
the unsaved diff over a host rewrite, so an external edit and unsaved typing
both survive. The eight unit tests in
`test/unit/document/dirty-merge.test.ts` cover the no-op, clean replace, dirty
merge, own-save echo, insert/delete shifting, disjoint inserts and CRLF cases.

It is **not yet called**. `Session.changed()` in
`src/plugins/document/session.ts:157` still takes the
"Dirty unexpected host rewrite: keep today's clear + record (slim: no merge)"
branch and calls `this.groups.clear()`, dropping the unsaved text.

## Wiring steps for the follow-up commit

1. Add `lastSaved: string` to `Session`, initialised to `document.getText()` in
   the constructor and updated in `markSaved()` / after a successful `save()`
   (the session already records `saveEcho`).
2. In `changed()`, when the buffer is dirty and the host text differs from the
   current authority, replace `this.groups.clear()` with
   `mergeExternalChange({ lastSaved: this.lastSaved, authority: this.text, hostText: newText })`
   and apply the merged result through the existing host-document path and
   `Authority.record` (use `prepare` only if a collab rebase is required).
   `Authority` has no `publish` method. Keep the existing echo / own-save
   guards ahead of this.
3. Then set `lastSaved` to the disk `hostText` just observed (the new common
   ancestor for a later rewrite), not to the merge-result string.
4. Add `Session`-level unit tests with `fakeDocument()` / `fakeHost()` for the
   six cases the backlog names (item 1 of
   `~/Code/obsidian-re/docs/implementation-plan.md`), including the
   "own-save echo must not trigger a merge" guard.

## Known limitation

Two edits to the exact same span are concatenated (host first) rather than
resolved with a conflict marker. Non-overlapping edits — the common case — are
handled. A full diff3 with conflict markers is future work, noted in the helper.

## Gates

`pnpm check`, `pnpm test:browser`, `pnpm test:quality`, and
`pnpm test:vscode` (the document layer is extension-host integration) before
the wiring lands.
