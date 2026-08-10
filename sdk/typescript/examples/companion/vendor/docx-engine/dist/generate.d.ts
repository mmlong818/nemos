import type { GeneratedBlock, ImageWrap, ParaFormat, Run, TableModel } from './types';
export interface GenerateContext {
    /** heading level -> styleId existing in the original styles.xml */
    headingStyleIds: Map<number, string>;
    /** styleId for list paragraphs, if present in the original doc */
    listParagraphStyleId?: string;
    /** allocate a new relationship id for a hyperlink target; returns rId */
    allocateHyperlinkRel: (href: string) => string;
}
export interface ImagePatch {
    /** new display size in CSS px; rewrites wp:extent and pic a:ext */
    widthPx?: number;
    heightPx?: number;
    /** paragraph alignment; null/'left' removes w:jc, undefined keeps as-is */
    align?: 'left' | 'center' | 'right' | null;
    /**
     * New horizontal/vertical posOffset (in EMU) for floating images. Rewrites
     * the <wp:posOffset> inside wp:positionH / wp:positionV.
     * Ignored when the anchor uses <wp:align> instead of <wp:posOffset>.
     */
    posOffsetX?: number;
    posOffsetY?: number;
    /** rotation in degrees clockwise; 0 removes the rot attribute; undefined keeps */
    rotDeg?: number;
    /** mirror flips; false removes the attribute; undefined keeps */
    flipH?: boolean;
    flipV?: boolean;
}
/**
 * Rewrite the display size (wp:extent + a:xfrm a:ext) and/or paragraph
 * alignment (w:jc) of an image paragraph, leaving everything else untouched.
 */
export declare function patchImageParagraphXml(xml: string, patch: ImagePatch): string;
/**
 * Switch an image paragraph between inline (in line with text, wrap = null) and floating
 * (wp:anchor with the given wrap mode). Position/wrap elements are rebuilt;
 * extent, docPr and the pic graphic stay untouched.
 *
 * When `posOffset` is provided, the anchor's positionH/V use numeric
 * `<wp:posOffset>` instead of `<wp:align>`, enabling free-position drag.
 */
export declare function applyImageWrap(xml: string, wrap: ImageWrap | null, posOffset?: {
    x: number;
    y: number;
}, marginAlign?: {
    h: 'left' | 'center' | 'right';
    v: 'top' | 'center' | 'bottom';
}): string;
export interface FieldTextPatch {
    left?: string;
    right?: string;
}
/**
 * Patch only cached visible w:t text in a field paragraph. Field instructions,
 * hyperlinks, tabs, run styling, and field boundaries remain byte-identical.
 */
export declare function patchFieldParagraphXml(xml: string, patch: FieldTextPatch): string;
/**
 * Patch OMML leaf token text without rebuilding its structural math nodes.
 * Token count must stay unchanged so fractions, scripts, matrices, and styling
 * remain exactly as authored by Word.
 */
export declare function patchMathTokens(xml: string, tokens: readonly string[]): string;
/** per-cell patch: plain paragraph strings, or nested-table cell texts by nested index */
export type CellTextsPatch = readonly string[] | {
    /** this cell's own text (optional; rewriting the outer text of a cell containing a nested table is not supported yet) */
    paras?: readonly string[] | null;
    /** one cell-text grid per direct nested table (null = leave that nested table untouched) */
    nested?: ReadonlyArray<ReadonlyArray<ReadonlyArray<readonly string[] | null | undefined> | null | undefined> | null>;
};
/**
 * Replace cell texts inside a <w:tbl> fragment.
 * `texts[row][cell]` = new paragraph strings for that cell (or a CellTextsPatch
 * carrying nested-table cell texts), or null/undefined to leave the cell
 * untouched. Indexes follow document order of w:tr / w:tc (matching
 * TableModel.rows, which includes vMerge-continue cells).
 */
export declare function patchTableCellTexts(tableXml: string, texts: ReadonlyArray<ReadonlyArray<CellTextsPatch | null | undefined> | null | undefined>): string;
/**
 * Replacement content for one textbox paragraph. `runs` carry the full rich
 * style (bold, color, size, ...) and are regenerated as fresh OOXML runs.
 * `align`: undefined keeps the original pPr untouched, null removes w:jc,
 * a value rewrites it.
 */
export interface TextboxParaPatch {
    runs: Run[];
    align?: 'left' | 'center' | 'right' | 'justify' | 'distribute' | null;
}
/**
 * Replace textbox paragraphs inside a paragraph fragment that carries
 * anchored DrawingML textboxes. `boxes[box]` = per-paragraph patches for that
 * box (visible-shape order, matching Block.textboxes), or null/undefined to
 * leave the box untouched. Word pairs every DrawingML shape with a VML twin
 * inside mc:Fallback whose w:txbxContent duplicates the content — fallback
 * copies are patched with the same paragraphs as the preceding visible box so
 * both renderings stay in sync.
 */
export declare function patchTextboxParas(paragraphXml: string, boxes: ReadonlyArray<ReadonlyArray<TextboxParaPatch | null | undefined> | null | undefined>): string;
/** Resize fixed DrawingML textboxes while preserving their anchors and styling. */
export declare function patchTextboxHeights(paragraphXml: string, heightsPx: ReadonlyArray<number | null | undefined>): string;
export interface TextboxSizePatch {
    wPx?: number | null;
    hPx?: number | null;
}
/** Resize fixed DrawingML textboxes/shapes while preserving anchors and styling. */
export declare function patchTextboxSizes(paragraphXml: string, sizes: ReadonlyArray<TextboxSizePatch | null | undefined>): string;
export interface ShapeStylePatch {
    /** solid fill hex without '#'; null = a:noFill; undefined = keep */
    fillHex?: string | null;
    /** outline color hex without '#'; null = no outline; undefined = keep */
    borderHex?: string | null;
}
/** Recolor floating shapes/textboxes/lines (same drawing set as extractTextboxes). */
export declare function patchShapeStyles(paragraphXml: string, styles: ReadonlyArray<ShapeStylePatch | null | undefined>): string;
/** Rewrite the first drawing's extent (chart/SmartArt graphicFrame paragraphs). */
export declare function patchDrawingExtent(paragraphXml: string, wPx: number, hPx: number): string;
/** Insertable line/connector kinds: stroke-only wps:wsp with optional arrow ends */
export declare const LINE_KINDS: Record<string, {
    prst: string;
    head?: boolean;
    tail?: boolean;
}>;
/** Insert a floating stroke-only line/connector paragraph (wp:anchor + wps:wsp). */
export declare function buildLineParagraphXml(opts: {
    kind: string;
    widthEmu?: number;
    heightEmu?: number;
    id?: number;
    colorHex?: string;
}): string;
/** CT_PPr child sequence (subset), for schema-ordered assembly and merging */
export declare const PPR_CHILD_ORDER: string[];
interface PPrChild {
    name: string;
    xml: string;
}
/** top-level child elements of an XML fragment (depth-aware, attrs kept) */
export declare function splitXmlChildren(xml: string): PPrChild[];
/**
 * Merge format-model changes into an original <w:pPr> slice. Like mergeRPrModel,
 * each managed child is compared group by group: when its raw bytes re-parse to
 * the current model value the group was not edited and keeps its original bytes,
 * so unmodeled attributes (w:firstLineChars, w:afterLines, autospacing, border
 * colors, shading patterns…) survive. Only genuinely changed groups are rebuilt
 * from the model (at their schema position) — a rebuilt w:ind intentionally drops
 * firstLineChars/leftChars so the user's new twips indent wins over the CJK
 * char-unit variant Word would otherwise prefer. Everything unmanaged — keepNext,
 * paragraph-mark rPr, pPrChange revision records... — keeps its original bytes.
 * When format.tabStops is set, w:tabs is also managed (replaced or removed).
 * When format.dropCap is set, w:framePr is also managed.
 */
export declare function mergePPrFormat(rawPPr: string, format: ParaFormat | undefined): string;
/**
 * Strip <w:pPrChange>...</w:pPrChange> from a raw <w:pPr> slice.
 * Used when the editor accepts or rejects a paragraph-property revision,
 * so the saved file no longer contains the pPrChange record.
 */
export declare function stripPPrChange(rawPPr: string): string;
/**
 * Insert or replace the live paragraph-property revision in a raw pPr slice.
 * The revision is last in CT_PPr schema order.
 */
export declare function setPPrChange(rawPPr: string, changeJson: string): string;
/**
 * Generate an OOXML <w:p> fragment for an edited/new block.
 * Only references styles that already exist in the original document, so the
 * patched file never needs styles.xml modifications. When `rawPPr` is set the
 * paragraph properties pass through byte-identical instead of being rebuilt.
 */
export declare function generateParagraphXml(block: GeneratedBlock, ctx: GenerateContext): string;
export interface TableGenOptions {
    /**
     * Style the first row as a header: light shading plus an empty bold run.
     * The bold run matters because patchTableCellTexts reuses the first run's
     * rPr when it fills in cell texts, so header texts come out bold.
     */
    headerRow?: boolean;
}
/** shading fill used for generated table header rows (hex without '#') */
export declare const TABLE_HEADER_FILL = "F2F2F2";
/**
 * Generate a complete table from the editable display model. This is used only
 * after structural edits; untouched tables and text-only edits keep their
 * original XML through the byte-preserving patch paths.
 */
export declare function generateTableModelXml(model: TableModel, originalTableXml?: string): string;
/**
 * Generate a self-contained w:tbl fragment (inline borders, no style reference),
 * so the patched file never needs styles.xml modifications.
 */
export declare function generateTableXml(rows: number, cols: number, opts?: TableGenOptions): string;
export interface TocEntry {
    /** heading level 1-9 */
    level: number;
    text: string;
    /** page number computed by real pagination (cached text; begin is dirty, so Word still recalculates on open) */
    pageNo?: number;
}
/**
 * Generate a real TOC field as one w:p fragment per line. The begin fldChar is
 * marked dirty so Word recalculates entries and page numbers on open; the
 * static entry texts serve as the visible result until then.
 */
export declare function generateTocFieldXml(entries: TocEntry[]): string[];
/**
 * Caption paragraph: `<label> <SEQ label> <text>`, e.g. "Figure 1 System architecture".
 * The SEQ field is marked dirty so Word renumbers all captions on open; the
 * static number is the visible result until then.
 */
export declare function generateCaptionXml(label: string, number: number, text: string): string;
/**
 * INDEX field as one w:p per cached entry line, alphabetically sorted. The
 * begin fldChar is dirty so Word rebuilds entries and page numbers on open.
 */
export declare function generateIndexFieldXml(terms: string[]): string[];
/** OOXML runs without relationship allocation (header/footer parts, ...) */
export declare function inlineRunsXml(runs: Run[]): string;
/** CT_RPr child sequence (subset), for schema-ordered assembly and merging */
export declare const RPR_CHILD_ORDER: string[];
/**
 * Merge the raw rPr slice with the run model: groups whose model value matches the raw
 * encoding keep their original bytes (double underline/themeColor/all four rFonts slots
 * do not degrade); mismatched (edited) groups are rebuilt from the model; children the
 * model does not cover (caps/vanish/dstrike/bdr/shd/spacing/lang…) are always kept.
 */
export declare function mergeRPrModel(rawRPr: string, run: Run, insideLink: boolean): string;
/**
 * Build a minimal <w:p> fragment that contains a floating WPS text-box anchored
 * at the cursor position with the given dimensions.
 *
 * @param widthEmu  horizontal size in EMU  (default ~5 cm = 1800000)
 * @param heightEmu vertical size in EMU    (default ~3 cm = 1080000)
 * @param id        wp:docPr id / name suffix (caller must keep unique)
 * @param fillHex   6-char solid fill hex colour (default "FFFFFF" = white)
 * @param borderHex 6-char border hex colour     (default "000000" = black)
 */
export declare function buildTextboxParagraphXml(opts?: {
    widthEmu?: number;
    heightEmu?: number;
    id?: number;
    fillHex?: string;
    borderHex?: string;
}): string;
/**
 * Build a <w:p> fragment for a floating WPS shape (prstGeom) with optional
 * text content. Same anchor structure as buildTextboxParagraphXml.
 */
export declare function buildShapeParagraphXml(opts: {
    prst: string;
    widthEmu?: number;
    heightEmu?: number;
    id?: number;
    fillHex?: string;
    borderHex?: string;
    withTextbox?: boolean;
}): string;
/**
 * Build a <w:p> fragment containing a floating WordArt WPS text box.
 * The shape has no background fill; the text runs carry large size (36pt)
 * and the specified solid color. Style is approximated (no stroke/effects in
 * the saved run — the caller picks a readable solid color) — Word can open
 * the result. Presets live in the UI layer (@genoffice/ui wordart-presets).
 */
export declare function buildWordArtParagraphXml(opts: {
    text?: string;
    /** 6-digit hex without '#'; defaults to the Office accent blue. */
    colorHex?: string;
    italic?: boolean;
    widthEmu?: number;
    heightEmu?: number;
    id?: number;
}): string;
export {};
