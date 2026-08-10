/**
 * <a:custGeom> custom geometry parsing (read-only rendering).
 *
 * fast-xml-parser does not preserve document order of mixed child nodes
 * (moveTo/lnTo/… order would be lost), so we scan tags in order directly over
 * the raw XML bytes.
 * Output is a normalized SVG path: coordinates 0..1, relative to each <a:path>'s
 * declared w/h; arcTo is converted to cubic beziers; gdLst/avLst formulas are
 * evaluated first so pt/arcTo can reference them.
 */
import type { CustomGeometry } from './types';
/**
 * gd formula evaluation (CT_GeomGuide fmla). Evaluated in order; may reference
 * earlier guides and built-in variables (w/h/ss/hc/vc/l/t/r/b/wdN/hdN/ssdN/cdN…,
 * angles in 1/60000 of a degree).
 */
export declare function evalGuides(gds: Array<{
    name: string;
    fmla: string;
}>, w: number, h: number): Record<string, number>;
/**
 * Extract and parse <a:custGeom> from a shape's raw XML.
 * shapeW/shapeH: element box in EMU (basis for guide evaluation; fallback space
 * when a path declares no w/h).
 */
export declare function parseCustGeom(shapeXml: string, shapeW: number, shapeH: number): CustomGeometry | undefined;
