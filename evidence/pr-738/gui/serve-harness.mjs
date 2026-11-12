import { createServer } from "node:http";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WIDE_FLOW = `flowchart LR
  start([Start]) --> intake[Intake request]
  intake --> review[Review the draft]
  review --> approve[Approve the change]
  approve --> publish[Publish the note]
  publish --> archive[Archive the source]
  archive --> notify[Notify the readers]
  notify --> done([Done])`;

const SECOND_WIDE = `flowchart LR
  alpha([Alpha]) --> bravo[Bravo step]
  bravo --> charlie[Charlie step]
  charlie --> delta[Delta step]
  delta --> echo[Echo step]
  echo --> foxtrot[Foxtrot step]
  foxtrot --> golf[Golf step]
  golf --> hotel([Hotel])`;

export const NOTE = `# Diagram toolbar evidence

A wide pipeline:

\`\`\`mermaid
${WIDE_FLOW}
\`\`\`

A second wide pipeline, consecutively:

\`\`\`mermaid
${SECOND_WIDE}
\`\`\`

اتجاه النص من اليمين إلى اليسار

after
`;

export function harnessHtml(direction) {
  const dir = direction === "rtl" ? "rtl" : "ltr";
  const note = JSON.stringify(NOTE);
  const config = JSON.stringify({ rightToLeft: dir === "rtl" });
  return `<!doctype html>
<html lang="en" dir="${dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PR 738 Mermaid toolbar harness</title>
  <link rel="stylesheet" href="/dist/webview/editor.css">
</head>
<body class="vscode-light" dir="${dir}">
  <main id="app" data-pdfium-wasm="/dist/webview/embedpdf.wasm"></main>
  <script src="/artifacts/fake-host.js"></script>
  <script>
    (async () => {
      try {
        const direction = "${dir}";
        const note = ${note};
        document.documentElement.dir = direction;
        document.body.dir = direction;
        const harness = new window.BrowserHost(note);
        window.harness = harness;
        harness.editorSettings = ${config};
        await harness.open("obsidian");
        await harness.configureEditor(${config});
        await harness.reveal(note.indexOf("A wide pipeline"));
        window.__harnessReady = true;
      } catch (error) {
        window.__harnessError = String(error && error.stack ? error.stack : error);
      }
    })();
  </script>
</body>
</html>`;
}

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function createHarnessServer({ root, port }) {
  const base = path.resolve(root);
  const allowed = ["dist", "artifacts", "test/fixtures", "examples"].map(
    (folder) => path.resolve(base, folder),
  );
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    try {
      if (url.pathname === "/health") {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify({ ok: true, service: "pr738-markdown-harness", port }));
        return;
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(harnessHtml(url.searchParams.get("dir")));
        return;
      }
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const target = path.resolve(base, relative);
      if (!allowed.some((folder) => target.startsWith(folder + path.sep))) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      const body = await readFile(target);
      const contentType = MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream";
      const headers = {
        "content-type": contentType,
        "cache-control": "no-store",
        "accept-ranges": "bytes",
      };
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(body.length - 1, range[2] ? Number(range[2]) : body.length - 1);
        response.writeHead(206, {
          ...headers,
          "content-range": `bytes ${start}-${end}/${body.length}`,
        });
        response.end(body.subarray(start, end + 1));
      } else {
        response.writeHead(200, headers);
        response.end(body);
      }
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500, {
        "content-type": "text/plain; charset=utf-8",
      });
      response.end(error?.code === "ENOENT" ? "Not found" : "Harness error");
    }
  });
}

const invoked = process.argv[1] ? realpathSync(path.resolve(process.argv[1])) : "";
const current = realpathSync(fileURLToPath(import.meta.url));
if (invoked === current) {
  const port = Number(process.env.PORT ?? "19238");
  const root = process.env.HARNESS_ROOT;
  if (!root) {
    throw new Error("HARNESS_ROOT is required");
  }
  const server = createHarnessServer({ root, port });
  server.listen(port, "127.0.0.1", () => {
    console.log(JSON.stringify({ ready: true, service: "pr738-markdown-harness", host: "127.0.0.1", port }));
  });
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
