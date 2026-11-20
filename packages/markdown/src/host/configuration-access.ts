import * as vscode from "vscode";
import { EffectiveConfiguration } from "./configuration";
import { watchedSections } from "./configuration-sections";

export function createConfiguration(): EffectiveConfiguration {
  const sections = watchedSections();
  const scoped = (resource?: string) =>
    vscode.workspace.getConfiguration(
      "lumiere.markdown",
      resource
        ? { uri: vscode.Uri.parse(resource), languageId: "markdown" }
        : undefined,
    );
  return new EffectiveConfiguration({
    get: (key, resource) => scoped(resource).get(key),
    inspect: (key, resource) => scoped(resource).inspect(key),
    onDidChange(listener) {
      const subscription = vscode.workspace.onDidChangeConfiguration(
        (event) => {
          if (sections.some((section) => event.affectsConfiguration(section))) {
            listener();
          }
        },
      );
      return () => subscription.dispose();
    },
  });
}
