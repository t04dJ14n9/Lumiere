import type { Mermaid } from "mermaid";

/** Use Mermaid's CSV grammar and normalized IDs, not an independent CSV parser. */
export async function defaultSankeyNodeColors(
  mermaid: Mermaid,
  source: string,
  colors: readonly string[],
): Promise<Record<string, string>> {
  // Apply the same sanitized frontmatter/directives used by the normal render.
  await mermaid.parse(source);
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
  const database = diagram.db as {
    getGraph(): { nodes: Array<{ id: string }> };
  };
  return Object.fromEntries(
    database
      .getGraph()
      .nodes.map(({ id }, index) => [id, colors[index % colors.length]!]),
  );
}
