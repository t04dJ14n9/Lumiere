import type { Context, Plugin } from "@workshop/core";
import type { PanelShell } from "../../shared/host";
import type {} from "../resources/api";
import type {} from "../vault/api";
import type {} from "../../shared/pdf-outlines";
import { protocol, type Suggestion } from "./protocol";
import { SuggestionIndex } from "./sources";
export const suggestHost: Plugin<{ panel: PanelShell }> = {
  name: "suggest",
  inject: {
    required: ["rpc", "vault", "settings"],
    optional: ["vaults", "hostDocuments", "resources", "pdfOutlines"],
  },
  apply(ctx, { panel }) {
    const vaults = ctx.vaults;
    const outlines = ctx.pdfOutlines;
    const index = new SuggestionIndex(
      ctx.vault,
      vaults && ((file) => vaults.text(file.uri)),
      outlines && ((file) => outlines.sections(file.uri)),
    );
    registerBlockIds(ctx);
    ctx.effect(() =>
      ctx.vault.onDidChange((change) => index.invalidate(change)),
    );
    ctx.effect(() => ctx.vault.onDidResolve(() => index.invalidate()));
    ctx.effect(() =>
      ctx.rpc.handle(protocol, "query", async (request, token) => {
        const feature = request.kind === "tag" ? "tags" : "links";
        const source = ctx.vault
          .files()
          .find((file) => file.uri === panel.document.uri)?.path;
        if (
          token.cancelled ||
          source === undefined ||
          ctx.settings.forNote(panel.document).features?.[feature]?.enabled ===
            false
        ) {
          return [];
        }
        await index.prepare(source, request, () => token.cancelled);
        if (token.cancelled) {
          return [];
        }
        return index.query(
          source,
          request,
          ctx.settings.forNote(panel.document).features?.links?.config
            .useWikilinks !== false,
        );
      }),
    );
  },
};

/**
 * A picked block in another note gets its id there, as in Obsidian, unless
 * that note changed where the id goes.
 */
function registerBlockIds(ctx: Context): void {
  ctx.effect(() =>
    ctx.rpc.handle(protocol, "addBlockId", (request) =>
      addBlockId(ctx, request),
    ),
  );
}

type BlockId = NonNullable<Suggestion["blockId"]>;

async function addBlockId(ctx: Context, request: BlockId): Promise<boolean> {
  const documents = ctx.hostDocuments;
  if (!documents || !isVaultNote(ctx, request.uri)) {
    return false;
  }
  try {
    await ctx.resources?.authorizeTarget?.(request.uri);
  } catch {
    return false;
  }
  const { uri, at, before, insert } = request;
  if (!Number.isInteger(at)) {
    return false;
  }
  const document = await documents.open(uri);
  const text = documents.text(uri) ?? document.getText();
  if (text.slice(at - before.length, at) !== before) {
    return false;
  }
  return documents.apply(document, [{ from: at, to: at, insert }]);
}

function isVaultNote(ctx: Context, uri: string): boolean {
  return ctx.vault.files().some((file) => file.uri === uri && !file.excluded);
}
