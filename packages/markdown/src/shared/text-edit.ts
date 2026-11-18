import { SourceCoordinates } from "./document/coordinates";
import type { TextEdit } from "./host";

/** Replace a whole note. Offsets are CodeMirror's, which `apply` expects. */
export function replaceAllEdit(source: string, next: string): TextEdit {
  const length = new SourceCoordinates(source).editor.length;
  return { from: 0, to: length, insert: next };
}
