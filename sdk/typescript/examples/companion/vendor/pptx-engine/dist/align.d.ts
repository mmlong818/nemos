/**
 * Element alignment and even distribution — pure geometry functions (no IO, no
 * model dependencies).
 *
 * Coordinate system: input/output are axis-aligned rects { x, y, w, h } in CSS px
 * (no rotation). Maps directly to the render layer's NodeBox (equivalent to
 * PlacedBox without rotation), so the UI layer can call it directly.
 *
 * Design:
 * - All 6 alignments are relative to the selection's bounding box (multi-select)
 *   or the page (single-select).
 * - The 2 distributions (horizontal/vertical) spread spacing evenly; require ≥3 elements.
 * - Returns each element's new { x, y } (w/h unchanged); only elements whose
 *   position changes appear in the result.
 */
export interface AlignRect {
    x: number;
    y: number;
    w: number;
    h: number;
}
export type AlignKind = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom';
export type DistributeKind = 'horizontal' | 'vertical';
/**
 * Compute each element's new x/y coordinates after alignment.
 *
 * @param rects   element rects (px), in the same order as their ids
 * @param kind    alignment type
 * @param containerRect  the page rect (in slide coordinates) for single-select;
 *                       null for multi-select → align relative to the selection's
 *                       bounding box
 * @returns       each element's new { x, y } (same order as rects)
 */
export declare function alignRects(rects: AlignRect[], kind: AlignKind, containerRect: AlignRect | null): Array<{
    x: number;
    y: number;
}>;
/**
 * Compute each element's new x/y after even distribution (only the coordinate
 * along the distribution axis changes).
 *
 * Distribution rule: the two end elements stay put, middle elements are spaced
 * evenly (divided by element centers).
 *
 * Requires rects.length ≥ 3; with fewer than 3 returns as-is (meaningless operation).
 *
 * @param rects element rects
 * @param kind  'horizontal' | 'vertical'
 * @returns     each element's new { x, y } (same order as rects)
 */
export declare function distributeRects(rects: AlignRect[], kind: DistributeKind): Array<{
    x: number;
    y: number;
}>;
