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
    optional: [
      "vaults",
      "hostDocuments",
      "resources",
      "pdfOutlines",
      "dialogs",
    ],
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
 * that note changed where the id goes. When it cannot be written the editor
 * links to the note instead, and the user is told why here, as the page has
 * no way to say it.
 */
function registerBlockIds(ctx: Context): void {
  ctx.effect(() =>
    ctx.rpc.handle(protocol, "addBlockId", (request) =>
      addBlockId(ctx, request),
    ),
  );
  ctx.effect(() =>
    ctx.rpc.on(protocol, "blockChanged", () =>
      ctx.dialogs?.inform(
        "The block changed before it could be given an ID, so no link was inserted. Pick it again.",
      ),
    ),
  );
}

type BlockId = NonNullable<Suggestion["blockId"]>;

async function addBlockId(ctx: Context, request: BlockId): Promise<boolean> {
  const problem = await blockIdProblem(ctx, request);
  if (problem !== undefined) {
    const note =
      ctx.vault.files().find((file) => file.uri === request.uri)?.path ??
      "that note";
    ctx.dialogs?.inform(
      `Lumiere could not give the block an ID in ${note}, because ${problem}. The link goes to the note.`,
    );
  }
  return problem === undefined;
}

/** Writes the id; if it cannot, why not, in words for the user. */
async function blockIdProblem(
  ctx: Context,
  request: BlockId,
): Promise<string | undefined> {
  const documents = ctx.hostDocuments;
  if (!documents) {
    return "this window cannot change notes";
  }
  if (!isVaultNote(ctx, request.uri)) {
    return "it is not in this vault, or is excluded from it";
  }
  try {
    await ctx.resources?.authorizeTarget?.(request.uri);
  } catch {
    return "it is outside the folders Lumiere may edit";
  }
  const { uri, at, before, insert } = request;
  if (!Number.isInteger(at)) {
    return "the place for it is not valid";
  }
  try {
    const document = await documents.open(uri);
    const text = documents.text(uri) ?? document.getText();
    if (text.slice(at - before.length, at) !== before) {
      return "it changed after the list was made";
    }
    const edited = await documents.apply(document, [
      { from: at, to: at, insert },
    ]);
    return edited ? undefined : "VS Code did not accept the edit";
  } catch {
    return "it could not be opened or edited";
  }
}

function isVaultNote(ctx: Context, uri: string): boolean {
  return ctx.vault.files().some((file) => file.uri === uri && !file.excluded);
}
