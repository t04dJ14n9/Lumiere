# Host GUI — CI-patched VSIX db38c368 (engines pageColors)

**Date:** 2026-11-03 Asia/Singapore  
**VSIX:** `/tmp/ci-vsix-db38/lumiere-0.1.10.vsix`  
**SHA256:** `84364375bf4387e1072c40536bdda2add0e29f239831e1ddbf5e7fbc869dafaa`  
**Markers:** `resolveEmbedPdfPageColors`, `0xff1e1e1e`, `useColorScheme` PRESENT in viewer.js  
**Fixture:** synthetic `workspace/dummy.pdf`

## Results

| Host | Mode | Paper | Status bar | Shot |
|------|------|-------|------------|------|
| VS Code 1.142.0 | Follow (Dark) | `#1e1e1e` / rgb(30,30,30) | Follow (Dark) | `vscode-follow-dark-dummy.png` |
| VS Code 1.142.0 | Dark (forced) | `#1e1e1e` | Dark | `vscode-dark-mode-dummy.png` |
| Cursor | Follow (Dark) | `#1e1e1e` | Follow (Dark) | `cursor-follow-dark-dummy.png` |
| VS Code 1.142.0 | Normal | white / rgb(255,255,255) | Normal | `vscode-normal-dummy.png` |

## Contrast: user fail VSIX

`/workspace/lumiere-0.1.10-main-db38c368.vsix` SHA256 `109ddc96…` — same commit lineage, markers **ABSENT** → soft-fail white Matrix while status can still show Follow (Dark).

## Conclusion

Not a VS Code runtime ColorScheme bug. Local package from stale unpatched `node_modules` omitted the engines patch from bundled `viewer.js`. CI-patched VSIX darkens paper on **both** real VS Code and Cursor.
