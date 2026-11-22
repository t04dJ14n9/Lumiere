import { annotationKey } from "@embedpdf/engine-core/public";
import { useAnnotationList, type Annotation } from "@embedpdf/react/annotation";
import { useDocuments } from "@embedpdf/react/runtime";
import React, { useCallback, useMemo, useState } from "react";
import {
  annotationRows,
  rowTooltip,
  type AnnotationRow,
  type MarkInput,
} from "../../shared/annotation-rows";
import { EmptyMessage, SectionHeader } from "./section-header";
import type { SidePanelJump } from "./side-panel";
import { Tree, type TreeNode } from "./tree";
import { useQuotedText } from "./use-quoted-text";

interface MarkRow extends TreeNode {
  mark: AnnotationRow;
  source: Annotation;
}

/**
 * Every mark of the PDF, the reader's and the file's own, in reading order,
 * with its icon, colour, page and what it says: the text it marks and its
 * note. A click goes to the mark and flashes its box.
 */
export function AnnotationsTab({
  jumpTo,
}: {
  jumpTo: SidePanelJump;
}): React.JSX.Element {
  const marks = useAnnotationList();
  const documents = useDocuments();
  const [selected, setSelected] = useState<string>();
  const rows = useMemo(
    () => markRows(marks, (page) => documents.getPageIndex(page) + 1),
    [marks, documents],
  );
  const open = useCallback(
    (row: MarkRow) => {
      setSelected(row.id);
      const { x, y, width, height } = row.source.rect;
      jumpTo({
        page: row.mark.page,
        viewRect: { left: x, top: y, width, height },
      });
    },
    [jumpTo],
  );
  return (
    <>
      <SectionHeader title="Annotations" count={rows.length} />
      {rows.length === 0 ? (
        <EmptyMessage>
          <p>This PDF has no annotations.</p>
          <p>Select text and right-click to highlight it.</p>
        </EmptyMessage>
      ) : (
        <Tree
          kind="list"
          label="Annotations"
          rows={rows}
          selectedId={selected}
          onOpen={open}
          renderRow={(row) => <MarkLabel row={row} />}
        />
      )}
    </>
  );
}

/** The marks that are the reader's to see, as rows in reading order. */
function markRows(
  marks: readonly Annotation[],
  pageNumberOf: (page: Annotation["page"]) => number,
): MarkRow[] {
  const sources = new Map<string, Annotation>();
  const inputs: MarkInput[] = [];
  for (const mark of marks) {
    const page = pageNumberOf(mark.page);
    if (page < 1) {
      continue;
    }
    const key = annotationKey(mark.ref);
    sources.set(key, mark);
    inputs.push({
      key,
      subtype: mark.subtype,
      page,
      top: mark.rect.y,
      left: mark.rect.x,
      color: "color" in mark ? mark.color : undefined,
      contents: mark.contents,
    });
  }
  return annotationRows(inputs).map((mark) => ({
    id: mark.key,
    mark,
    source: sources.get(mark.key)!,
    depth: 0,
    expandable: false,
    expanded: false,
  }));
}

function MarkLabel({ row }: { row: MarkRow }): React.JSX.Element {
  const { mark, source } = row;
  const quote = useQuotedText(source, mark.quotesText);
  return (
    <>
      <i
        className={`sp-icon codicon codicon-${mark.icon}`}
        aria-hidden="true"
      />
      {mark.color && (
        <span
          className="sp-swatch"
          style={{ backgroundColor: mark.color }}
          aria-hidden="true"
        />
      )}
      <span
        className="sp-label"
        title={rowTooltip(mark, quote, source.contents)}
      >
        {quote ?? mark.label}
      </span>
      {mark.note && <span className="sp-description">{mark.note}</span>}
      <span className="sp-page">p. {mark.page}</span>
    </>
  );
}
