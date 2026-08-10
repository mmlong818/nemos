import { PackageArchive } from './zip';
import { type GradientFillPatch, type SlideTransitionKind } from './generate';
import { type NewTableOptions } from './insert';
import type { Paragraph, SlideDeck, Slide, SlideElement, TextElement, GroupElement } from './types';
import { type TableStyleEdit } from './table-edit';
import { type NewChartKind } from './chart-insert';
import { type SlideBundle } from './slide-transfer';
export * from './types';
export { animClassOf, buildTimingXml, DEFAULT_MOTION_PATH, elementSpid, getSlideAnimations, patchSlideTimingIncrementalXml, patchSlideTimingXml, readSlideTimingXml, setSlideAnimations, type AnimClass, type AnimEffectKind, type AnimTrigger, type SlideAnimation, } from './animation';
export { PackageArchive } from './zip';
export { scanSlide, type SlideScan, type SpElement } from './scan';
export { parseSlide, parseDecorations, EMU_PER_PT, type ParseContext, type DecorationOptions, } from './parse';
export { tableRowGridCols } from './table-grid';
export { parseTheme, type Theme } from './theme';
export { patchTextElementXml, patchElementXfrm, patchElementFill, patchElementPPr, patchParagraphPPrXml, patchElementStroke, patchBodyPrAutofit, patchPictureSrcRect, patchSlideAdvanceTimeXml, patchSlideBackgroundXml, patchSlideHiddenXml, patchSlideTransitionXml, readSlideAdvanceTimeXml, readSlideHiddenXml, readSlideTransitionXml, generateParagraphXml, generateXfrmXml, type GradientFillPatch, type SlideTransitionKind, } from './generate';
export { addElement, addPicture, deleteElement, buildSpXml, buildTableXml, buildGrpSpXml, calcBoundingBox, type NewElementOptions, type NewPictureOptions, type NewShapeKind, type NewTableOptions, } from './insert';
export { alignRects, distributeRects, type AlignKind, type DistributeKind, type AlignRect, } from './align';
export { createBlankPptx } from './blank';
export { promoteSlideBackground, isBackgroundLikeElement } from './background-promote';
export { applyThemeToArchive, buildColorMap, collectExplicitColors, patchThemeXml, recolorXml, remapDeckColors, type ThemeSpec, } from './theme-apply';
export { escapeXmlText, escapeXmlAttr } from './xml-utils';
export { extractFormat, applyFormat, type CopiedFormat, type ShapeFormat, type TextRunFormat, type ParagraphFormat, type FormatPatchResult, } from './format-brush';
export { listSlideLayouts, type SlideLayoutInfo, type LayoutPlaceholder } from './layout';
export { BUILTIN_LAYOUTS, BUILTIN_LAYOUT_PREFIX, builtinLayoutInfos, ensureBuiltinLayout, shouldOfferBuiltinLayouts, type BuiltinLayoutDef, } from './builtin-layouts';
export { parsePlaceholderMap, resolvePlaceholderTransform, parseMasterTextStyles, parseLstStyleLevels, placeholderStyleChain, mergeTextStyleChain, type PlaceholderMap, type PlaceholderGeom, type LevelTextStyle, type TextStyleLevels, type MasterTextStyles, } from './placeholder';
export { resolveFontRef } from './theme';
export { resolveColorNode, applyColorMods } from './color';
export { parseChartXml, type ChartModel, type ChartSeries, type ChartKind, type ChartAxisStyle, } from './chart';
export { getSlideNotes, setSlideNotes, notesPathForSlide, unescapeXml } from './notes';
export { getSlideComments, addSlideComment, deleteSlideComment, type SlideComment, } from './comments';
export { setElementLink, getElementLink, getSlideLinks, getRunLinks, ensureRunLinkRels, encodeRunLink, decodeRunLink, type LinkTarget, } from './hyperlink';
export { addChart, buildChartSpaceXml, type NewChartKind, type NewChartOptions, } from './chart-insert';
export { addSmartArt, buildSmartArtXml, type SmartArtLayout, type NewSmartArtOptions, } from './smartart';
export { addMedia, addModel3d, model3dPartOf, solidPng, type NewMediaOptions, type NewModel3dOptions, } from './media-insert';
export { applyHeaderFooter, readHeaderFooter, type HeaderFooterOptions } from './headerfooter';
export { getSections, setSections, addSection, renameSection, removeSection, moveSection, moveSlide, normalizeSections, type SectionInfo, } from './sections';
export { collectSlideBundle, importSourceLayout, materializeSlideBundle, chooseLayout, listLayouts, type SlideBundle, type SlideBundleChain, } from './slide-transfer';
export { patchTableStyleXml, findTableElementInSlide, ensureTableStyleXml, TABLE_STYLE_PRESETS, type TableStyleEdit, type TableStylePreset, } from './table-edit';
export { listMasterParts, parseMasterPart, type MasterPartInfo } from './master-edit';
export interface OpenedPptx {
    deck: SlideDeck;
    archive: PackageArchive;
}
export declare function openPptx(bytes: Uint8Array): Promise<OpenedPptx>;
/**
 * Rebuild the deck model from the archive's current entries — same result as
 * openPptx(await savePptx(opened)) without materializing the zip, whose contiguous
 * output buffer fails outright on large decks. Pending edits must already be baked
 * into the entries (commitSaved).
 */
export declare function reparseDeck(opened: OpenedPptx): OpenedPptx;
/**
 * Save (element-level patches, Phase 3.3).
 *
 * - With no dirty elements: write original entries back byte-for-byte, producing a
 *   slideN.xml 100% identical to the original.
 * - Slides with dirty elements: rebuild that slideN.xml = bodyPrefix + each element
 *   (dirty ? patch-regenerated : original byte slice) + bodySuffix; all other
 *   entries are copied byte-for-byte.
 * - Non-text elements (pictures/passthrough) don't support content editing yet;
 *   even flagged dirty they use original bytes.
 */
export declare function savePptx(opened: OpenedPptx): Promise<Uint8Array>;
/**
 * Same output as savePptx, written straight to `filePath`.
 *
 * Prefer this for anything that lands on disk: savePptx has to assemble the whole
 * package into one contiguous buffer, which on a large deck fails outright with
 * "Array buffer allocation failed". Streaming keeps peak memory to a chunk at a
 * time. JSZip throws stream errors from inside its own scheduled callbacks, so the
 * stream's 'error' event — not just the returned promise — has to be handled or the
 * throw escapes as an uncaught exception and takes the process down.
 */
export declare function savePptxToFile(opened: OpenedPptx, filePath: string): Promise<void>;
/**
 * Sync the in-memory model with what savePptx/savePptxToFile just wrote, without
 * the full reopen (readFile + sha256 + unzip + reparse) that used to double save
 * latency and peak memory on large decks.
 *
 * For every dirty slide this bakes the patched XML back into archive.entries and
 * anchor.originalXml, then clears the dirty flags — exactly the state a reopen
 * would produce, minus new element ids. Uses the same patchSlideXml /
 * patchedElementXml pair as buildZip, so memory and disk are byte-identical and
 * the next save's byte slices are safe to reuse.
 *
 * Call only after a successful save; on failure keep the dirty state so the next
 * save retries the patches.
 */
export declare function commitSaved(opened: OpenedPptx): void;
/**
 * Rebuild one slideN.xml: dirty elements are patch-regenerated, the rest pass
 * through as original bytes. With no dirty elements the result == originalXml.
 */
export declare function patchSlideXml(slide: Slide): string;
/** One element's current XML slice (dirty elements patch-regenerated, clean elements original bytes). */
export declare function patchedElementXml(el: SlideElement): string;
/** Set a solid slide background: patch the bodyPrefix and sync the model (written back with the whole-slide rebuild on save). */
export declare function setSlideBackground(slide: Slide, color: string): void;
/**
 * Update a picture element's srcRect crop (0..1 fractions, null = full image).
 * Flags dirtySrcRect so save surgically patches <a:srcRect>; no other bytes are
 * touched. Returns whether the element was found and updated.
 */
export declare function editPictureSrcRect(slide: Slide, sourceId: string, srcRect: {
    l: number;
    t: number;
    r: number;
    b: number;
} | null): boolean;
/**
 * Text-box vertical alignment (bodyPr anchor: t/ctr/b). Byte surgery baked directly into originalXml.
 */
export declare function setElementTextAnchor(slide: Slide, elementId: string, anchor: 'top' | 'middle' | 'bottom'): boolean;
/**
 * Shape image fill: after landing the image in the package (media + rels), the
 * spPr fill node is replaced with a blipFill, byte surgery baked directly into
 * originalXml. Returns the mediaPath (for render-layer decoding), null on failure.
 */
export declare function setElementImageFill(opened: OpenedPptx, slide: Slide, elementId: string, bytes: Uint8Array, ext: string): string | null;
/**
 * Whole-picture opacity (0..1; ≥1 clears alphaModFix). Byte surgery on the
 * <a:blip> child, baked directly into originalXml (no separate dirty flag).
 */
export declare function setPictureOpacity(slide: Slide, sourceId: string, opacity: number): boolean;
/**
 * Swap a picture's backing image for new bytes, keeping frame, z-order, border
 * and effects. New media part + rel; the <a:blip> reference is re-pointed via
 * byte surgery baked into originalXml (same pattern as setPictureOpacity).
 * srcRect is kept only when the caller knows the new image shares the old one's
 * pixel geometry (e.g. background-removal output) — otherwise the stale crop
 * would show an arbitrary window of the new image.
 */
export declare function replacePictureBytes(opened: OpenedPptx, slide: Slide, sourceId: string, bytes: Uint8Array, ext: string, opts?: {
    keepSrcRect?: boolean;
}): boolean;
/**
 * Duplicate the sourceIndex slide as a new slide inserted after it; returns the
 * new slide model.
 *
 * The new slideK.xml includes the source slide's unsaved patches; rels are copied
 * verbatim but with notesSlide removed, so two slides don't share the same notes.
 */
export declare function duplicateSlide(opened: OpenedPptx, sourceIndex: number, opts?: {
    clearText?: boolean;
}): Slide | null;
/**
 * Snapshot a slide for pasting into another deck (or back into this one),
 * including its unsaved edits and every part it references.
 */
export declare function copySlide(opened: OpenedPptx, sourceIndex: number): SlideBundle | null;
/**
 * Paste a bundle after `afterIndex` (-1 pastes at the front). By default the
 * slide adopts a layout from this deck — matched by the source layout's name,
 * else the neighbour's — so it takes on the destination theme ("use destination
 * theme"). With `keepSourceFormatting` the bundled layout→master→theme chain is
 * imported instead, so the slide keeps its source look; falls back to the
 * destination theme when the bundle carries no chain.
 */
export declare function pasteSlide(opened: OpenedPptx, afterIndex: number, bundle: SlideBundle, opts?: {
    keepSourceFormatting?: boolean;
}): Slide | null;
/**
 * Insert a truly blank slide after the sourceIndex slide: content is an empty
 * spTree, rels only point at the source slide's slideLayout — layout/master
 * background and decorations carry over, slide elements are empty.
 */
export declare function insertBlankSlide(opened: OpenedPptx, sourceIndex: number): Slide | null;
/**
 * Merge the single slide of a one-slide pptx into the target deck (appended at
 * the end).
 *
 * Used by the html→pptx pipeline's per-slide independent conversion: each slide's
 * HTML converts into its own single-slide pptx, and on landing that slide is moved
 * into the existing deck **without reconverting earlier slides**.
 *
 * Precondition (pipeline homogeneity): all single-slide pptx files share the same
 * layout/master/theme structure, so the appended slide reuses the target's
 * existing slideLayout (the source's layout/master/theme is not imported); only
 * the slide XML + the media it references are moved (rIds reassigned to avoid
 * cross-slide name clashes), notesSlide dropped.
 */
export declare function mergeSlideFromPptx(target: OpenedPptx, sourceBytes: Uint8Array): Promise<Slide | null>;
/**
 * Insert a blank slide after the sourceIndex slide, with rels pointing at the
 * given layoutPath (from listSlideLayouts). The layout itself is read-only, never
 * written back. Returns the new Slide, or null on failure.
 */
export declare function insertSlideWithLayout(opened: OpenedPptx, sourceIndex: number, layoutPath: string): Slide | null;
/**
 * Delete a slide: the sldId in presentation.xml, the presentation rels, the
 * [Content_Types] Override, the slide part and its rels are all removed;
 * deck.slides synced. Refused when only one slide remains.
 */
export declare function deleteSlide(opened: OpenedPptx, index: number): boolean;
export type ReorderDirection = 'front' | 'back' | 'forward' | 'backward';
/** Adjust an element's z-order (the elements array order is the spTree order); returns whether anything changed. */
export declare function reorderElement(slide: Slide, elementId: string, dir: ReorderDirection): boolean;
/**
 * Write the slide's current state (incl. unsaved patches) back to the archive and
 * reparse, replacing the model in the deck. New elements appended as raw XML
 * slices go through here, gaining a full semantic model for any element type.
 * Note: after reparse all element ids on the slide change; the caller must rebuild
 * the render tree for the whole slide.
 */
export declare function materializeSlide(opened: OpenedPptx, slideIndex: number): Slide | null;
/**
 * Re-lay connectors after connected shapes move: the geometry box = the bounding
 * box of the two endpoints, direction expressed via flip (exact for straight
 * connectors; elbow connectors approximated by the same bounding box). An
 * unattached end keeps its current endpoint. Returns the number of connectors
 * updated (>0 means each is flagged dirtyTransform).
 */
export declare function updateConnectorsForMoved(slide: Slide, movedIds: string[]): number;
/**
 * Write/clear a connector's shape attachments (<a:stCxn>/<a:endCxn> in
 * p:cNvCxnSpPr; id = target shape's cNvPr id, idx = connection point index).
 * undefined leaves that end unchanged, null detaches it. Byte surgery baked
 * directly into originalXml (pending patches are materialized first).
 */
export declare function setElementConnection(slide: Slide, elementId: string, patch: {
    start?: {
        id: number;
        idx: number;
    } | null;
    end?: {
        id: number;
        idx: number;
    } | null;
}): boolean;
/**
 * Switch an existing slide's layout: point the slide rels' slideLayout
 * relationship at the new layout, then reparse (inheritance chain/decoration
 * layer/placeholder default styles all refreshed). Placeholder positions are kept
 * (existing shapes stay put; use resetSlideLayout to snap
 * them back). Layout placeholders with no counterpart on the slide are added as
 * empty prompt boxes (PowerPoint semantics).
 */
export declare function setSlideLayout(opened: OpenedPptx, slideIndex: number, layoutPath: string): Slide | null;
/**
 * Reset layout: placeholder elements drop their explicit <a:xfrm>, geometry falls
 * back to layout/master inheritance (restoring the inherited
 * position/size).
 */
export declare function resetSlideLayout(opened: OpenedPptx, slideIndex: number): Slide | null;
/**
 * Slide size (16:9 ↔ 4:3 etc.): edits <p:sldSz> in presentation.xml.
 * Content reflows with the canvas: each axis scales independently
 * (sx = cx/oldCx, sy = cy/oldCy), like PowerPoint's stretch on size change.
 * Anisotropic on purpose — it fills the new canvas with no letterbox bands
 * and makes A→B→A a true round-trip (within 1 EMU of rounding), which a
 * uniform fit-and-center scale cannot be. Font sizes are left alone.
 */
export declare function setSlideSize(opened: OpenedPptx, cx: number, cy: number): boolean;
/** Append a batch of raw shape slices at the slide end and materialize; returns the new slide and new element ids (in append order). */
export declare function appendRawElements(opened: OpenedPptx, slideIndex: number, xmls: string[]): {
    slide: Slide;
    elementIds: string[];
} | null;
/** Insert a table: build a graphicFrame slice, append, and reparse. */
export declare function addTable(opened: OpenedPptx, slideIndex: number, opts: NewTableOptions): {
    slide: Slide;
    elementId: string;
} | null;
/**
 * Rewrite table cell text: XML surgery (replacing the txBody paragraphs of the
 * col-th a:tc inside the row-th a:tr, keeping bodyPr/lstStyle/tcPr) with the model
 * synced. col is the tc index (not the logical column).
 */
export declare function editTableCellText(slide: Slide, elementId: string, row: number, col: number, paragraphs: Paragraph[]): boolean;
/**
 * Table style editing (surgical patch of a:tblPr + a:tcPr):
 * apply a preset style or change firstRow/bandRow/shading/borders without touching
 * cell text. anchor.originalXml is patched directly; structureDirty=true triggers
 * the save rebuild.
 */
export declare function editTableStyle(slide: Slide, elementId: string, edit: TableStyleEdit): boolean;
/**
 * Ensure ppt/tableStyles.xml contains the given custom style (injected the first
 * time a preset is applied). Creates the part when missing, adding the
 * [Content_Types].xml Override and presentation rels.
 */
export declare function ensureTableStylePart(opened: OpenedPptx, styleId: string, styleDefXml: string): void;
/**
 * Chart editing (charts created by this app, rebuilding the chart part):
 * find the element's chart part path (via slide rels), rebuild the XML with the
 * new data/type/colors, and write it back to the archive. structureDirty=true
 * triggers a reparse.
 */
export declare function editChartElement(opened: OpenedPptx, slideIndex: number, elementId: string, patch: {
    kind?: NewChartKind;
    /** Bar direction for an explicit type change ('bar' = horizontal) */
    barDir?: 'col' | 'bar';
    categories?: string[];
    series?: Array<{
        name: string;
        values: number[];
    }>;
    title?: string;
    colorScheme?: string[];
    legendPos?: 'b' | 't' | 'r' | 'l' | 'none';
    dataLabels?: boolean;
    gridlines?: boolean;
    /** '' = clear */
    catAxisTitle?: string;
    valAxisTitle?: string;
    gapWidthPct?: number;
    /** Swap rows/columns: categories ↔ series (mutually exclusive with categories/series patches, triggered separately in the UI) */
    switchRowCol?: boolean;
    /** Per-point fill overrides, seriesIdx → pointIdx → color; null clears back to the series color */
    pointColors?: Record<number, Record<number, string | null>>;
}): boolean;
/**
 * Mark a chart not created by this app as editable (cNvPr descr="aislides-chart"):
 * only tags it without rewriting the chart part (the conversion itself is
 * lossless); subsequent edits go through editChartElement's rebuild template, and
 * fine-grained formatting beyond the parsed model (number formats/per-point
 * styles etc.) is dropped at that point.
 */
export declare function markChartEditable(slide: Slide, elementId: string): boolean;
/** Read a chart element's current data (for dialog echo-back). */
export declare function getChartElementData(slide: Slide, elementId: string): {
    kind: string;
    title: string;
    categories: string[];
    series: Array<{
        name: string;
        values: number[];
    }>;
    seriesColors: Array<string | undefined>;
    pointColors: Array<Array<string | undefined> | undefined>;
} | null;
/**
 * Elements without text (pictures/charts etc.) return false.
 */
export interface ElementFontPatch {
    fontFamily?: string;
    fontSizePt?: number;
    strike?: boolean;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    /** #RRGGBB (explicit color: clears theme-link/inheritance flags) */
    color?: string;
}
export declare function setElementFont(slide: Slide, elementId: string, patch: ElementFontPatch): boolean;
export interface ReplaceOptions {
    matchCase?: boolean;
    /** Replace only the first match (the "Replace" button; default replaces all) */
    firstOnly?: boolean;
    /** Restrict to one slide/element (the "Replace" button acts on the currently hit element) */
    slideIndex?: number;
    elementId?: string;
}
/**
 * Deck-wide replace (matches within a run; cross-run matches are not handled —
 * consistent with byte-faithful run-structure patches). Covers text/shape, table
 * cells, and direct group children; dynamic field runs are skipped.
 * Returns the replacement count; elements on changed slides are flagged dirty.
 */
export declare function replaceAllInDeck(deck: SlideDeck, find: string, replace: string, opts?: ReplaceOptions): {
    count: number;
    changedSlides: number[];
};
export interface ParagraphFormatPatch {
    /** 'char' round bullet / 'number' numbering / 'none' explicitly none */
    bullet?: 'char' | 'number' | 'none';
    /** Custom bullet character (with bullet: 'char'; defaults to '•') */
    bulletChar?: string;
    /** Bullet hanging indent (EMU); alone it adjusts existing bullets' indent */
    bulletHangEmu?: number;
    /** Bullet size (% of text size, 100 = same); alone it only touches bulleted paragraphs */
    bulletSizePct?: number;
    /** Bullet color (#RRGGBB); alone it only touches bulleted paragraphs */
    bulletColor?: string;
    /** Line spacing (%, 100 = single) */
    lineSpacingPct?: number;
    /** Space before / after (pt) */
    spaceBeforePt?: number;
    spaceAfterPt?: number;
    align?: Paragraph['align'];
    /** Indent level delta (multi-level list Tab/⇧Tab; clamp 0..8) */
    indentDelta?: 1 | -1;
}
/**
 * Change paragraph formatting directly on a selected element (bullet/line
 * spacing/paragraph spacing/alignment), applied to all of its paragraphs
 * (text/shape/table; same as clicking bullets with a shape selected in PowerPoint).
 * paraIndices restricts the patch to those paragraphs (editing-mode selection).
 */
export declare function setElementParagraphFormat(slide: Slide, elementId: string, patch: ParagraphFormatPatch, paraIndices?: number[]): boolean;
/** Paragraph formatting for a group child (same semantics as setGroupChildFont; the pPr patch is baked straight into the group bytes). */
export declare function setGroupChildParagraphFormat(slide: Slide, groupId: string, childId: string, patch: ParagraphFormatPatch, paraIndices?: number[]): boolean;
export type TableStructureOp = {
    kind: 'insert-row';
    index: number;
    before?: boolean;
} | {
    kind: 'delete-row';
    index: number;
} | {
    kind: 'insert-col';
    index: number;
    before?: boolean;
} | {
    kind: 'delete-col';
    index: number;
};
/**
 * Table row/column insert/delete (XML surgery + materialize/reparse):
 * - Inserted rows/columns clone the reference row/column's formatting with text
 *   cleared; the table frame grows/shrinks with the total row height/column width.
 * - Deleting is refused when only 1 row/column remains; tables with merged cells
 *   are always refused.
 * After reparse element ids change; the new table id is found back by element position.
 */
export declare function editTableStructure(opened: OpenedPptx, slideIndex: number, elementId: string, op: TableStructureOp): {
    slide: Slide;
    elementId: string;
} | null;
export type TableMergeOp = {
    kind: 'merge-right';
    row: number;
    col: number;
} | {
    kind: 'merge-down';
    row: number;
    col: number;
} | {
    kind: 'split';
    row: number;
    col: number;
};
/**
 * Merge/split cells (XML surgery + materialize/reparse). v1 constraints:
 * merge-right requires anchor rowSpan=1 and a plain right neighbor; merge-down
 * requires anchor gridSpan=1 and a plain neighbor below (an already-merged anchor
 * can keep extending). The absorbed cell's text folds into the anchor.
 */
export declare function mergeTableCells(opened: OpenedPptx, slideIndex: number, elementId: string, op: TableMergeOp): {
    slide: Slide;
    elementId: string;
} | null;
/**
 * Set a column's width (EMU): gridCol w + frame ext.cx synced, model updated in
 * place (no reparse, element ids stable — good for drag resizing).
 */
export declare function setTableColWidth(slide: Slide, elementId: string, col: number, wEmu: number): boolean;
/** Set a row's height (EMU): <a:tr h> + frame ext.cy synced (matching setTableColWidth semantics). */
export declare function setTableRowHeight(slide: Slide, elementId: string, row: number, hEmu: number): boolean;
/**
 * Resize a table by proportionally redistributing <a:gridCol w> and <a:tr h>
 * (PowerPoint's behavior). Without this, setting the frame's a:ext leaves the
 * internal grid at its old size, so other software renders the old dimensions
 *. The frame ext is synced to the redistributed sums.
 */
export declare function resizeTable(slide: Slide, elementId: string, cx: number, cy: number): boolean;
/** Cell text vertical alignment (tcPr anchor: t/ctr/b). Byte surgery + model sync. */
export declare function setTableCellAnchor(slide: Slide, elementId: string, row: number, col: number, anchor: 'top' | 'middle' | 'bottom'): boolean;
export interface ElementClipboardItem {
    /** The element's current XML slice (incl. unsaved patches) */
    xml: string;
    /** rId referenced by the xml → absolute part path (External relationships keep the target verbatim) */
    rels: Array<{
        rid: string;
        type: string;
        target: string;
        external?: boolean;
    }>;
}
/** Copy: grab the element's current XML and the relationships it references (part paths that pictures/charts etc. point at). */
export declare function copyElementData(opened: OpenedPptx, slide: Slide, el: SlideElement): ElementClipboardItem;
/**
 * Paste: rels surgery (reuse the rId when the target slide already has a
 * relationship with the same type+target, otherwise create one pointing at the
 * same part — media bytes are not copied), renumber cNvPr ids, offset the whole
 * thing, append, and reparse.
 */
export declare function pasteElements(opened: OpenedPptx, slideIndex: number, items: ElementClipboardItem[], shiftEmu: {
    dx: number;
    dy: number;
}): {
    slide: Slide;
    elementIds: string[];
} | null;
/** Set/clear the transition (writes bodySuffix, persisted with the whole-slide rebuild on save). */
export declare function setSlideTransition(slide: Slide, kind: SlideTransitionKind): void;
/** Read the current transition. */
export declare function getSlideTransition(slide: Slide): SlideTransitionKind;
/** Set/clear the auto-advance time (advTm, ms; saved by rehearsal timing, auto-advances in PowerPoint slideshows). */
export declare function setSlideAdvanceTime(slide: Slide, ms: number | null): void;
/** Read the auto-advance time (ms; null when unset). */
export declare function getSlideAdvanceTime(slide: Slide): number | null;
/** Hide/unhide a slide (<p:sld show="0">, skipped in PowerPoint slideshows). */
export declare function setSlideHidden(slide: Slide, hidden: boolean): void;
/** Read whether the slide is hidden. */
export declare function getSlideHidden(slide: Slide): boolean;
/**
 * Fetch a slide's patch-rebuilt result directly (Phase 1: with no dirty elements
 * it should equal originalXml). Lets tests verify the scan's
 * prefix/elements/suffix concatenation is lossless.
 */
export declare function reassembleSlideXml(slide: Slide): string;
/**
 * Group multiple editable elements (text/shape/picture) into one p:grpSp.
 *
 * - Removes the selected elements from slide.elements, builds the p:grpSp XML and appends at the slide end
 * - Goes through the appendRawElements → materialize path (structureDirty=true, rebuilt on save)
 * - Only accepts text/shape/picture; passthrough/table/chart/group are refused outright
 * - Requires at least 2 elements
 *
 * Returns: { slide: fresh Slide, groupId: new group element id } or null (failure)
 */
export declare function groupElements(opened: OpenedPptx, slideIndex: number, sourceIds: string[]): {
    slide: Slide;
    groupId: string;
} | null;
/**
 * Ungroup: lift the group's children to the slide top level.
 *
 * Coordinate conversion rules:
 * - If childOffset defines a child coordinate system (chOff/chExt), child
 *   coordinates are based on it.
 * - This implementation sets chOff=off, chExt=ext (1:1 mapping) in buildGrpSpXml,
 *   so child coordinates are directly slide coordinates; groups from old files
 *   get the generic conversion too.
 * - Conversion: slideX = childX - chOff.x + group.off.x (plus * ext/chExt when scaled)
 *
 * Old-file groups pass their bytes through wholesale; after ungrouping they take
 * the rebuild path (structureDirty=true). Passthrough children (charts etc.)
 * keep their originalXml slices.
 *
 * Returns a fresh Slide or null.
 */
export declare function ungroupElement(opened: OpenedPptx, slideIndex: number, sourceId: string): Slide | null;
export interface GroupChildSlice {
    start: number;
    end: number;
    xml: string;
    nvId?: string;
}
/** Direct child slices of the group XML (document order; a nested group's inner elements are not double-counted). */
export declare function groupChildSlices(grpXml: string): GroupChildSlice[];
/** Patch the in-group slice matching child.nvId in place; returns true on success. */
export declare function patchGroupChildXml(grp: GroupElement, child: SlideElement, patch: (xml: string) => string): boolean;
/** Top-level group and its direct child (in-group editing goes one level; a nested subgroup is edited as a whole). */
export declare function findGroupChild(slide: Slide, groupId: string, childId: string): {
    grp: GroupElement;
    child: SlideElement;
} | null;
/** Group-child geometry editing (offset is in the child EMU coordinate system, incl. chOff). */
export declare function editGroupChildTransform(slide: Slide, groupId: string, childId: string, offset: {
    x: number;
    y: number;
    cx: number;
    cy: number;
}, rotationDeg: number): boolean;
/** Group-child text editing: called after model paragraphs are updated; regenerates the slice's txBody. */
export declare function patchGroupChildText(slide: Slide, groupId: string, child: TextElement): boolean;
/** Change font/size on a whole group child (same run-level semantics as setElementFont). */
export declare function setGroupChildFont(slide: Slide, groupId: string, childId: string, patch: ElementFontPatch): boolean;
/** Group-child fill ('none' | #RRGGBB(AA) | gradient). */
export declare function editGroupChildFill(slide: Slide, groupId: string, childId: string, fill: string | GradientFillPatch): boolean;
/** Group-child stroke (null = remove the stroke). */
export declare function editGroupChildStroke(slide: Slide, groupId: string, childId: string, stroke: {
    color: string;
    widthEmu: number;
    dash?: string;
} | null): boolean;
