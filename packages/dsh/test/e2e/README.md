# DSH end-to-end suite

`dsh-e2e.mjs` exercises the installed Lumière DSH bundle against a **running**
DeepSeek Harness instance. It covers 47 scenarios: the HTTP routes and their
validation, authentication, the WebSocket handshake and RPC, the editor in a
real browser (rendering, saving, themes, images, embedder messages, special
paths), the bundle manifest and boot graph, and opening files through DSH's own
file tree.

## Run

```sh
DSH_URL=http://127.0.0.1:61440 \
DSH_COOKIE='dsh-auth-…=…' \
node packages/dsh/test/e2e/dsh-e2e.mjs
```

`DSH_COOKIE` is the browser session cookie for the harness web server. On
macOS, when it is omitted the script reads the desktop profile's loopback
cookies from `~/Library/Application Support/@deepseek-ai/dsh-desktop/Cookies`.
It never writes outside a fresh temporary directory; each scenario is
independent and the script exits non-zero if any fail.

The suite needs `@playwright/test` (a root dev dependency) and `ws` (a
`host-node` dependency), plus `sqlite3` for the local cookie fallback. It is a
manual integration check, not part of `pnpm test`: it requires a live harness
with the bundle installed.
