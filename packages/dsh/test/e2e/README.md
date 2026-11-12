# DSH end-to-end suite

`dsh-e2e.mjs` exercises a built Lumière DSH bundle installed into a **running**
DeepSeek Harness instance. It runs 47 checks (46 distinct names): the HTTP
routes and their validation, authentication, the WebSocket handshake and RPC,
the editor in a real browser (rendering, saving, images, themes, embedder
messages, special paths), the workspace bundle manifest and the running
install's boot graph, and opening files through DSH's own file tree.

## Run

Start a pinned DSH with a throwaway `DSH_HOME` and a disposable workspace
containing `README.md` and `.gitignore`, as in the host plan's DSH end-to-end
pass. Set `DSH_URL` to that instance and copy that profile's browser session
cookie into `DSH_COOKIE`; never use the owner's desktop profile or a demo
profile.

```sh
DSH_URL=http://127.0.0.1:61440 \
DSH_COOKIE='dsh-auth-…=…' \
node packages/dsh/test/e2e/dsh-e2e.mjs
```

Both environment variables are required; the runner does not read a local
cookie database. It writes its note and image fixtures only in a fresh
temporary directory. Checks are sequential and share panel, browser and console
state; the real-app checks use short fixed waits and the open workspace's file
tree. The script exits non-zero on any failure; skips are counted separately
from passes.

The suite needs `@playwright/test` (a root dev dependency) and `ws` (a
`host-node` dependency). The live runner is a manual integration check, not
part of `pnpm test`: it requires a live harness with the bundle installed. The
harness-free `*.test.mjs` contract tests are unit tests and do run in
`packages/dsh`'s `pnpm test` and the workspace's `pnpm check`.
