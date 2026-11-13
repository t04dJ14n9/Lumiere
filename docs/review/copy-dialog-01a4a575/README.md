# Unsaved Copy dialog — generic installed-app evidence

This branch is **review evidence only**. It does not change the product fix. The product branch remains `fix/unsaved-copy-duplicate-cancel` at `01a4a5757358708628786d32aca00513b9d0e953`.

Host: official **Visual Studio Code 1.146**, not Cursor. Command: `lumiere.markdown.copyLinkForAgent`. Generic fixture only.

## Identity

| Item | Value |
| --- | --- |
| Product head (installed and packaged) | `01a4a5757358708628786d32aca00513b9d0e953` |
| Fix commit | `c30c32d6c592c7185162715f07fe06a6248d1f09` |
| Base / `main` | `f1c153d51df481ec493800ca491544d56b7df66b` |
| Packaged artifact | `lumiere-0.1.11` VSIX for that head, sha256 `e0f58a9a9291c897f4cd7d57de8c58753aab0ffa76cfbfeff76c26425bde0ff4` |
| Payload `extension/dist/extension.js` | sha256 `542428cb71db1f74239fe2eb29d767b3b784cbbe5a1af42f2697a56470eaba73` |

The earlier `c30c32d6` VSIX is not the current-head artifact (zip hash differs; the three production payload members are byte-identical to the head VSIX).

## Before vs after (not a matched-profile pixel comparison)

- **Before** is the actual `b8c4acb1` installed artifact, **not main-exact**. Its Copy `agent.ts` bytes match base and this head. Its host `workbench.ts` matches **base** (pre-fix), not this head. Dialog chrome is a **white native OS / GTK** window titled “Visual Studio Code.”
- **After** is this head on a **different isolated profile**, with a **custom dark VS Code** modal.
- Same official VS Code 1.146 binary. Do not treat the shots as pixel-equal or as the same profile.

## Screenshots

All fixtures are generic (`Note.md`, “Fixture note”, “Original line”, “Unsaved test line”). OS taskbars and unrelated windows were cropped out of the full-window shots.

| File | Case |
| --- | --- |
| `before-old722-dialog-tight.png` | Before (`b8c4acb1`): four buttons, **two Cancel** |
| `after-dialog-crop-v2.png` | After (this head): three buttons, **one Cancel** |
| `after-cancel-dirty-selection.png` | Cancel: note still dirty, selection kept |
| `after-cancel-clipboard-sentinel.png` | Cancel: pre-set clipboard sentinel unchanged |
| `after-text-only-paste.png` | Copy Text Only: pasted text is `Unsaved test line` |
| `after-save-and-copy-toast.png` | Save and Copy: note clean; toast “Link and passage copied: paste them into your agent's chat.” |
| `after-save-and-copy-paste.png` | Save and Copy clipboard: `@Note.md#4`, a blank line, then `> Unsaved test line` |
| `after-saved-note-repeat-toast.png` | Saved note, command repeated: no unsaved prompt in this result; same toast |
| `after-saved-note-repeat-paste.png` | Same payload pasted a second time |

Esc and modal-X dismiss-without-write was observed in the same session; post-dismiss stills for those two are not in this set.

## Checks (honest)

- Current-head `pnpm check` exited 0. Focused suites in that same log: 3 `dialogs-ask` tests and 5 `agent-bridge` tests, all passed (8/8), fail 0.
- That check is **not** a claim that every test ran. In the `@workshop/pdf` unit suite the log reported 774 passed, 0 failed, and **1 skipped**: `arXiv 2503.20783 page 2: adjacent cite fragments cluster; far repeats do not`, because a local paper fixture was missing. This writer did not control that skip and does not treat it as an approved waiver.
- `test:vscode`, CDP, and browser-quality suites were **not run**.
- CI on this publication is unknown until the draft PR’s own run is visible.
- An earlier local `pnpm check` on the fix-only commit (`c30c32d6`) also exited 0, but its root RAM admission used a lower 8 GiB fallback instead of the required 9 GiB stable rule. That procedural miss is kept as a separate record. It is not this current-head check.

## Review

Final independent review (R3) is still pending. This is not a merge-ready claim.
