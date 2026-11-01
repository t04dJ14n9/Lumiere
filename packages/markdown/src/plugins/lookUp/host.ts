import type { Plugin } from "@workshop/core";
import type { Navigation, PanelShell } from "../../shared/host";
import { protocol } from "./protocol";
import { isLookUpPlatform, isLookUpWord, lookUpUrl } from "./words";

/** What opening a word in the Dictionary app needs from its host. */
export interface DictionaryHost {
  /** The OS the plugins run on, as Node's `process.platform` names it. */
  readonly platform: string;
  readonly navigation: Pick<Navigation, "external">;
}

/**
 * Answers a note's Look Up: the webview names the word, this half opens it
 * in macOS's Dictionary app. The webview is untrusted, so the word is checked
 * again here and the `dict:` URL is built here; nothing else can be opened.
 */
export const lookUpHost: Plugin<{ panel: PanelShell }> = {
  name: "lookUp",
  inject: { required: ["rpc", "navigation"] },
  apply(ctx) {
    const host: DictionaryHost = {
      platform: hostPlatform(),
      navigation: ctx.navigation,
    };
    ctx.effect(() =>
      ctx.rpc.handle(protocol, "lookUp", ({ word }) =>
        openInDictionary(word, host),
      ),
    );
  },
};

/** Opens `word` in the Dictionary app; false off macOS or for anything but one word. */
export async function openInDictionary(
  word: string,
  host: DictionaryHost,
): Promise<boolean> {
  if (!isLookUpPlatform(host.platform) || !isLookUpWord(word)) {
    return false;
  }
  return host.navigation.external(lookUpUrl(word));
}

/**
 * The OS of the process the plugins run in. VS Code's extension host and
 * host-node are Node; host-web runs the same plugins in a browser, which has
 * no `process` (and no Dictionary app to open), so there it is "". Read
 * through `globalThis` because host-web compiles these plugins without
 * Node's types.
 */
function hostPlatform(): string {
  const runtime = (globalThis as unknown as { process?: { platform?: string } })
    .process;
  return runtime?.platform ?? "";
}
