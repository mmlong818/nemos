/**
 * Table grid-column accounting shared by parse (style lookups) and pptx-render (cell
 * geometry). Pure and dependency-free: pptx-render's renderer bundle imports this
 * subpath, so it must not pull in Node-only modules.
 */
/**
 * Starting grid column of each tc in a row. Standard OOXML rows carry one tc per grid
 * column (merge continuations included), so each tc advances the cursor by 1; when a
 * gridSpan anchor's continuation tcs are absent (non-standard producers) the anchor
 * advances by its span instead.
 */
export declare function tableRowGridCols(row: Array<{
    gridSpan?: number;
    merged?: boolean;
}>): number[];
