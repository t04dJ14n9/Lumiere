/** Whether Delete/Backspace should remove selected annotations (Annotate mode). */
export function shouldDeleteAnnotationOnKey(options: {
  key: string;
  annotate: boolean;
  hasAnnotationSelection: boolean;
  /** The key goes to an editable field of the page (an input). */
  editable: boolean;
  /** Someone is typing in a free-text box: the key edits its text. */
  editingText?: boolean;
}): boolean {
  if (
    options.editable ||
    options.editingText === true ||
    !options.annotate ||
    !options.hasAnnotationSelection
  ) {
    return false;
  }
  return options.key === "Delete" || options.key === "Backspace";
}
