# DSH end-to-end suite

`dsh-e2e.mjs` exercises a built Lumière DSH bundle installed into a **running**
DeepSeek Harness instance. It runs 58 checks (57 distinct names): the HTTP routes and
their validation, authentication, method handling, byte ranges, static-file
containment, PDF pages and viewer assets, the WebSocket handshake and RPC,
the editor in a real browser (rendering, saving, themes, images, embedder
messages, special paths), settings and view endpoints, containment to each panel's
own workspace, the workspace bundle manifest and the running install's boot
graph, and opening files through DSH's own file tree.
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
cookie database. It writes its note and PDF fixtures only in a fresh
temporary directory, and the static symlink scenario adds and removes one
`__e2e_escape.js` symlink in the installed bundle's static tree, removed in
`finally`. Checks are sequential and share panel, browser and console state;
the real-app checks use short fixed waits and the open workspace's file tree.
The script prints PASS/FAIL/SKIP per check and exits non-zero on any failure;
skips are counted separately from passes.
The suite needs `@playwright/test` (a root dev dependency) and `ws` (a
`host-node` dependency). The live runner is a manual integration check, not
part of `pnpm test`: it requires a live harness with the bundle installed. The
harness-free `*.test.mjs` contract tests are unit tests and do run in
`packages/dsh`'s `pnpm test` and the workspace's `pnpm check`.

The views snapshot and SSE preamble contract also has a harness-free
regression (`views-sse-check.test.mjs`) that does not need a live DSH:

```sh
node --test packages/dsh/test/e2e/views-sse-check.test.mjs
```

The PDF scenarios copy `packages/pdf/test/fixtures/generated/short.pdf`. That
file is gitignored and is produced by `pnpm --filter @workshop/pdf fixtures`
(`node test/fixtures/make-fixtures.mjs` in the PDF package), not by the DSH
bundle build. Generate it before running this suite if it is missing; a fresh
checkout with only the installed bundle will otherwise fail with ENOENT.
