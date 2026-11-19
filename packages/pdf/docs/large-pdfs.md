# Large PDFs

What the viewer does with a PDF's bytes, and the largest file it opens.

## One read per change, for every pane

Each editor of a PDF has its `PdfSource` (`src/host/viewer/source.ts`), but
the file behind them is shared (`src/host/viewer/shared-file.ts`), one per
file URI and host, kept while an editor of it is open:

- one watcher for the file, however many panes show it;
- a change on disk, once it has settled (150 ms), is read and hashed once,
  and the bytes go to every pane, each of which reloads only if they differ
  from what it shows (or from what it just wrote);
- panes that read the file at the same moment (opening it, a reload) share
  that read. A read that has finished is not handed out again: the next one
  reads the file, so a pane never opens bytes older than the file.

The SHA-256 (which names the annotation file) is computed in 16 MB slices,
yielding between them, so a large PDF does not hold up the extension host.

Outside VS Code (`packages/host-node`), the pages of one workspace share
one set of files, so they share reads the same way.

## The size limit

The viewer opens PDFs up to **512 MB** (`MAX_PDF_BYTES`; a host may set
`PdfFiles.maxBytes`). A larger file is refused before it is read, when the
host can tell its size (VS Code and host-node both can), with a message
naming the file and the limit; a host that cannot is refused once the bytes
are read. The file is not streamed instead: the engine opens a PDF only
from its whole bytes in memory, and those are held by the extension host,
the message to the viewer, and the engine's WASM heap, so a much larger
file would risk the webview rather than only be slow.

The bookmark reader for `[[paper.pdf#` completions has its own, lower
limit (200 MB), as it runs in the extension host.

## Why the viewer cannot load a PDF by range

Outside VS Code, `packages/host-node` serves the bytes at
`/lumiere/pdf/bytes` and answers `Range` requests. The viewer still fetches
the whole file once, because EmbedPDF 3.0.0, the engine it runs, opens a
document in the browser only from all its bytes:

- `LocalEngine.open` (`@embedpdf/engine`) accepts `kind: "bytes"`,
  `"layerBytes"` and `"layerFile"` and rejects anything else ("local engine
  only supports OpenInput.kind === 'bytes', 'layerBytes' or 'layerFile'").
  `bytes` and `layerBytes` take a `Uint8Array | ArrayBuffer` of the whole
  file, which becomes the `open.fatMem` / `open.layerMemBase` request: the
  whole file copied into PDFium's WASM heap.
- `layerFile` is the one input PDFium range-reads, and only from a file
  path on the native Node runtime: in the WASM runtime the worker answers
  "'layerFile' needs the native Node runtime; open the file's bytes
  instead" (`@embedpdf/engine-services`, `handleOpen`).
- The inputs that load from a server (`id`, `token`, `grant`) belong to the
  cloud engine and speak EmbedPDF's own document API, not HTTP ranges of a
  file.
- PDFium's own progressive loading (`FPDFAvail_*`, `FPDF_LoadCustomDocument`
  with a block reader) needs synchronous reads from inside the WASM call.
  The runtime ships `FPDF_LoadCustomDocument` in its function table, but no
  input or request of EmbedPDF 3 reaches it, and a page cannot answer a
  synchronous read from the network without blocking the worker.

So what the hosts do instead is hold as few copies as they can:

- VS Code sends the bytes in the `load` message; the extension host keeps
  none of them once sent.
- host-node keeps the newest load's bytes for its page only until the page
  has fetched them whole (a ranged request leaves them), then lets them go;
  serving a range is a view of those bytes, not a copy. The pages of one
  workspace share each read of a file.
- The viewer page lets its fetched copy go as soon as the engine has opened
  the document (`engine.tsx`). Until then it hands the engine a view, which
  the engine copies: an `ArrayBuffer` would be moved into the worker,
  leaving nothing for the main-thread engine to open if the worker fails.

If a later EmbedPDF opens a document from a range reader in the browser,
the host route is ready for it.
