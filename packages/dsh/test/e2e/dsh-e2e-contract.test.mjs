import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const suiteUrl = new URL("./dsh-e2e.mjs", import.meta.url);
const suiteSource = readFileSync(suiteUrl, "utf8");

test("importing the suite module does not start the live harness", async () => {
  const started = Date.now();
  const mod = await import(suiteUrl.href);
  assert.equal(typeof mod.check, "function");
  assert.equal(typeof mod.skip, "function");
  assert.equal(typeof mod.staticTraversalRefused, "function");
  assert.equal(typeof mod.symlinkEscapeRefused, "function");
  assert.equal(typeof mod.summarize, "function");
  assert.ok(Array.isArray(mod.results));
  assert.ok(Date.now() - started < 5000, "import blocked as if the live suite started");
});

test("the live suite calls the shared traversal and symlink helpers", () => {
  assert.match(suiteSource, /staticTraversalRefused\s*\(/);
  assert.match(suiteSource, /symlinkEscapeRefused\s*\(/);
  assert.doesNotMatch(
    suiteSource,
    /\/lumiere\/m\/\.\.\/\.\.\/\.\.\/\.\.\/etc\/passwd/,
    "suite still uses the URL-collapsed raw-dot probe",
  );
});

test("check() records a normal return as PASS", async () => {
  const { check, results, resetResults, summarize } = await import(suiteUrl.href);
  resetResults();
  await check("ok path", async () => "detail");
  const summary = summarize(results);
  assert.equal(results[0].ok, true);
  assert.equal(summary.passed.length, 1);
  assert.equal(summary.skipped.length, 0);
  assert.equal(summary.failed.length, 0);
  assert.equal(summary.exitCode, 0);
  assert.match(summary.line, /1 passed, 0 skipped, 0 failed \(1 checks\)/);
});

test("skip() is recorded as SKIP and is excluded from the pass count", async () => {
  const { check, skip, results, resetResults, summarize } = await import(
    suiteUrl.href
  );
  resetResults();
  await check("unsupported", async () => {
    skip("symlink unsupported (EPERM)");
  });
  const summary = summarize(results);
  assert.equal(results[0].ok, "skipped");
  assert.equal(results[0].detail, "symlink unsupported (EPERM)");
  assert.equal(summary.passed.length, 0);
  assert.equal(summary.skipped.length, 1);
  assert.equal(summary.failed.length, 0);
  assert.equal(summary.exitCode, 0);
  assert.match(summary.line, /0 passed, 1 skipped, 0 failed \(1 checks\)/);
});

test("returning a skip-like string is not a substitute for skip()", async () => {
  const { check, results, resetResults, summarize } = await import(suiteUrl.href);
  resetResults();
  await check("old skip", async () => "skipped (symlink exists)");
  const summary = summarize(results);
  // A returned string is still a completed check (PASS). Callers must use skip()
  // so unsupported cases stay out of the pass count — this guards the helper contract.
  assert.equal(results[0].ok, true);
  assert.equal(summary.passed.length, 1);
  assert.equal(summary.skipped.length, 0);
  assert.equal(summary.exitCode, 0);
});

test("unexpected errors are FAIL and trip a non-zero exit", async () => {
  const { check, results, resetResults, summarize } = await import(suiteUrl.href);
  resetResults();
  await check("boom", async () => {
    const error = new Error("EEXIST: file already exists");
    error.code = "EEXIST";
    throw error;
  });
  const summary = summarize(results);
  assert.equal(results[0].ok, false);
  assert.match(String(results[0].detail), /EEXIST/);
  assert.equal(summary.passed.length, 0);
  assert.equal(summary.skipped.length, 0);
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.exitCode, 1);
});

test("staticTraversalRefused keeps /lumiere/m/ after URL parse and requires 403", async () => {
  const { staticTraversalRefused, check, results, resetResults, summarize } =
    await import(suiteUrl.href);
  const seen = [];
  const get = async (url) => {
    seen.push(url);
    return { status: 403 };
  };
  resetResults();
  await check("static path traversal refused", () =>
    staticTraversalRefused({
      base: "http://127.0.0.1:61440",
      get,
      assert,
    }),
  );
  assert.equal(seen.length, 1);
  const outbound = new URL(seen[0]);
  assert.ok(
    outbound.pathname.startsWith("/lumiere/m/"),
    `get() received collapsed pathname ${outbound.pathname}`,
  );
  assert.equal(results[0].ok, true);
  assert.equal(summarize(results).exitCode, 0);
});

test("staticTraversalRefused fails when the host returns 404", async () => {
  const { staticTraversalRefused, check, results, resetResults, summarize } =
    await import(suiteUrl.href);
  resetResults();
  await check("static path traversal refused", () =>
    staticTraversalRefused({
      base: "http://127.0.0.1:61440",
      get: async () => ({ status: 404 }),
      assert,
    }),
  );
  assert.equal(results[0].ok, false);
  assert.match(String(results[0].detail), /expected 403/);
  assert.equal(summarize(results).exitCode, 1);
});

test("symlinkEscapeRefused skips only documented unsupported codes, outside the pass count", async () => {
  const { symlinkEscapeRefused, check, skip, results, resetResults, summarize } =
    await import(suiteUrl.href);
  const scratch = mkdtempSync(path.join(tmpdir(), "lumiere-e2e-contract-"));
  try {
    resetResults();
    const error = new Error("operation not permitted");
    error.code = "EPERM";
    await check("file route: symlink escaping the workspace refused", () =>
      symlinkEscapeRefused({
        base: "http://127.0.0.1:61440",
        scratch,
        path,
        pathToFileURL,
        symlinkSync() {
          throw error;
        },
        openPanel() {
          throw new Error("openPanel should not run on skip");
        },
        get() {
          throw new Error("get should not run on skip");
        },
        skip,
        assert,
        md: path.join(scratch, "plain.md"),
      }),
    );
    const summary = summarize(results);
    assert.equal(results[0].ok, "skipped");
    assert.match(String(results[0].detail), /EPERM/);
    assert.equal(summary.passed.length, 0);
    assert.equal(summary.skipped.length, 1);
    assert.equal(summary.exitCode, 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("symlinkEscapeRefused fails on EEXIST and other unexpected symlink errors", async () => {
  const { symlinkEscapeRefused, check, skip, results, resetResults, summarize } =
    await import(suiteUrl.href);
  const scratch = mkdtempSync(path.join(tmpdir(), "lumiere-e2e-contract-"));
  try {
    resetResults();
    const error = new Error("EEXIST: file already exists");
    error.code = "EEXIST";
    await check("file route: symlink escaping the workspace refused", () =>
      symlinkEscapeRefused({
        base: "http://127.0.0.1:61440",
        scratch,
        path,
        pathToFileURL,
        symlinkSync() {
          throw error;
        },
        openPanel() {
          throw new Error("openPanel should not run");
        },
        get() {
          throw new Error("get should not run");
        },
        skip,
        assert,
        md: path.join(scratch, "plain.md"),
      }),
    );
    assert.equal(results[0].ok, false);
    assert.match(String(results[0].detail), /EEXIST/);
    assert.equal(summarize(results).passed.length, 0);
    assert.equal(summarize(results).skipped.length, 0);
    assert.equal(summarize(results).exitCode, 1);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("symlinkEscapeRefused requires 403 when the link exists and names the symlink in the URI", async () => {
  const { symlinkEscapeRefused, check, skip, results, resetResults, summarize } =
    await import(suiteUrl.href);
  const scratch = mkdtempSync(path.join(tmpdir(), "lumiere-e2e-contract-"));
  try {
    const seen = [];
    resetResults();
    await check("file route: symlink escaping the workspace refused", () =>
      symlinkEscapeRefused({
        base: "http://127.0.0.1:61440",
        scratch,
        path,
        pathToFileURL,
        symlinkSync(target, link) {
          seen.push({ target, link });
        },
        openPanel: async () => ({ panel: "panel-1", socket: { close() {} } }),
        get: async (url) => {
          seen.push({ url });
          return { status: 404 };
        },
        skip,
        assert,
        md: path.join(scratch, "plain.md"),
      }),
    );
    assert.equal(seen[0].target, "/etc/hosts");
    const request = new URL(seen[1].url);
    const uri = request.searchParams.get("uri");
    assert.ok(uri, "missing file uri");
    assert.match(decodeURIComponent(uri), /escape\.md$/);
    assert.doesNotMatch(decodeURIComponent(uri), /\/etc\/hosts$/);
    assert.equal(results[0].ok, false, "404 must not pass as a refusal");
    assert.match(String(results[0].detail), /expected 403/);
    assert.equal(summarize(results).exitCode, 1);

    resetResults();
    await check("file route: symlink escaping the workspace refused", () =>
      symlinkEscapeRefused({
        base: "http://127.0.0.1:61440",
        scratch,
        path,
        pathToFileURL,
        symlinkSync() {},
        openPanel: async () => ({ panel: "panel-1", socket: { close() {} } }),
        get: async () => ({ status: 403 }),
        skip,
        assert,
        md: path.join(scratch, "plain.md"),
      }),
    );
    assert.equal(results[0].ok, true);
    assert.equal(summarize(results).exitCode, 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
