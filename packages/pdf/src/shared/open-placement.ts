/** An open editor of a PDF, as far as placing an open that keeps the focus needs. */
export interface OpenEditor {
  /** The editor group it is in; undefined when it is not in a group. */
  viewColumn: number | undefined;
  /** Its tab is the one its group shows. */
  visible: boolean;
}

/**
 * The open editor of a PDF that an open which must not take the focus (an
 * agent's) shows: one the reader can already see, else one in a group the
 * keyboard is not in. An editor hidden behind a tab of the active group is
 * neither, because showing it would cover the editor the keyboard is in
 * (typing would go on into a hidden note); that PDF opens beside instead.
 */
export function editorToShow<T extends OpenEditor>(
  editors: readonly T[],
  activeColumn: number | undefined,
): T | undefined {
  return (
    editors.find((editor) => editor.visible) ??
    editors.find((editor) => editor.viewColumn !== activeColumn)
  );
}
