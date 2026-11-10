# Autosave wiring — next step for issue #697

`src/plugins/document/autosave.ts` is the pure, unit-tested two-second scheduler
for issue #697. It is deliberately not armed yet: `documentHost` must own the
lifecycle so a timer never outlives a panel.

## Where to wire it

`src/plugins/document/host.ts` `documents.session(document)` creates one
`Session` per open `HostDocument` and counts references; `release(document)`
drops the session when the last panel closes. The scheduler belongs there:

```ts
// in the entry stored in `sessions`, next to `session` and `references`:
autosave?: AutosaveScheduler;

// when the FIRST panel attaches (session references goes 0 -> 1):
const scheduler = new AutosaveScheduler({
  clock: hostAutosaveClock(),
  isDirty: () => document.isDirty,
  isUntitled: () => document.isUntitled,
  save: () => session.save(),
});
scheduler.start();
entry.autosave = scheduler;

// when the LAST panel releases (references -> 0), before deleting the entry:
entry.autosave?.dispose();
```

`ctx.effect(() => () => { for (const e of sessions.values()) e.autosave?.dispose(); sessions.clear(); })`
covers host shutdown.

## Why it is not in this commit

`fakeDocument()` in `test/support/vscode-fake.ts` defaults `isDirty: true`, and
several existing `documentHost` unit tests create sessions without attaching a
panel. Arming real `setTimeout` there would keep node:test alive for two seconds
per test and could fire saves against fakes mid-assertion. The wiring should
therefore use an injected clock in the host services (or start only on the
first `Session.attach`) and add a `documentHost` unit test with a fake clock,
in its own commit.

## Acceptance criteria for the wiring commit

- A panel open for >2 s with a dirty saved note triggers `saveDocument`.
- A clean note, an untitled note and a closed panel trigger nothing.
- A save already in flight is not overlapped (the scheduler guards this).
- Existing `document/` unit tests still pass with no stray timers.
- `pnpm check`, `pnpm test:browser`, `pnpm test:quality` pass; `pnpm test:vscode`
  for the editor-integration change.
