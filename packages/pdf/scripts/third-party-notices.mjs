// Writes THIRD_PARTY_NOTICES.md from the licenses of the code the extension
// ships: EmbedPDF (and EmbedPDF Runtime, the PDFium fork it contains), React,
// the codicons, and the MCP SDK and zod that the agent bridge bundles.
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const packageDirectory = (name) => path.join(root, "node_modules", name);
// embedpdf.wasm's package ships only the Apache-2.0 license of EmbedPDF's own
// code. PDFium's notice is carried by @embedpdf/core-fonts, the engine's
// dependency that holds the fonts taken from PDFium, which pnpm links beside
// the engine and not in this package's node_modules. The file opens with a
// sentence about those fonts; the notice starts at its copyright line.
const pdfiumNotice = path.join(
  realpathSync(packageDirectory("@embedpdf/engine")),
  "../core-fonts/THIRD_PARTY_NOTICES",
);

const sections = [
  [
    "EmbedPDF (@embedpdf/*)",
    path.join(packageDirectory("@embedpdf/core"), "LICENSE"),
  ],
  [
    "EmbedPDF Runtime, the PDFium fork compiled into embedpdf.wasm (@embedpdf/engine-runtime-wasm32)",
    path.join(packageDirectory("@embedpdf/engine-runtime-wasm32"), "LICENSE"),
  ],
  ["PDFium (compiled into embedpdf.wasm)", pdfiumNotice],
  ["React and React DOM", path.join(packageDirectory("react"), "LICENSE")],
  [
    "Codicons font (@vscode/codicons)",
    path.join(packageDirectory("@vscode/codicons"), "LICENSE"),
  ],
  [
    "Codicons code (@vscode/codicons)",
    path.join(packageDirectory("@vscode/codicons"), "LICENSE-CODE"),
  ],
  [
    "MCP TypeScript SDK (@modelcontextprotocol/sdk), in the agent bridge",
    path.join(packageDirectory("@modelcontextprotocol/sdk"), "LICENSE"),
  ],
  ["Zod, in the agent bridge", path.join(packageDirectory("zod"), "LICENSE")],
];

const licenseText = (file) => {
  const text = readFileSync(file, "utf8").trim();
  return file === pdfiumNotice ? text.slice(text.indexOf("Copyright")) : text;
};

const body = sections
  .map(
    ([title, file]) =>
      `## ${title}\n\n\`\`\`text\n${licenseText(file)}\n\`\`\``,
  )
  .join("\n\n");
writeFileSync(
  path.join(root, "THIRD_PARTY_NOTICES.md"),
  `# Third-party notices\n\nThis extension includes the following software.\n\n${body}\n`,
);
