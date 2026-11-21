# Lumière outside VS Code: moved off `main`

On 2026-11-21 the owner decided that `main` is the VS Code and Cursor
extension only. Every host outside VS Code left `main` and lives, frozen, on
the branch
[`hosts-snapshot-2026-11-21`](https://github.com/t04dJ14n9/Lumiere/tree/hosts-snapshot-2026-11-21),
at commit `db1a5aaf` (the last `main` that had them). That branch takes no
further merges from `main`.

On that branch:

| What | Where |
| --- | --- |
| The plugins' host outside VS Code (services, editor routes, tree views) | `packages/host-node` |
| The same host in a browser, on a browser's or the iPad's folders | `packages/host-web` |
| Lumière in DeepSeek Harness | `packages/dsh` |
| Lumière's own server and Typora-like window | `packages/app` |
| The Tauri desktop app, the static web app, the iPad app | `apps/desktop`, `apps/web`, `apps/ipad` |
| This plan in full: layers, contracts, milestones, deferred limits | `docs/HOSTS_PLAN.md` |
| The iPad plan (local vaults, sync, Apple Pencil) | `docs/IPAD_PLAN.md` |
| The `sketch` plugin (Apple Pencil drawing in a note) and the sketch format and `ink` service it drew with | `packages/markdown/src/plugins/sketch`, `packages/ink` |
| The web host handoff | `docs/handoff/web-host.md` |

What stayed on `main`: the extension (`src/`, `test/`) and the packages it
builds from (`packages/core`, `packages/agents`, `packages/markdown`,
`packages/pdf`). The host services in
`packages/markdown/src/shared/host` remain the seam between the Markdown
plugins and VS Code ([ARCHITECTURE.md section 6](ARCHITECTURE.md#6-host-services-the-seam-between-plugins-and-a-host)).
