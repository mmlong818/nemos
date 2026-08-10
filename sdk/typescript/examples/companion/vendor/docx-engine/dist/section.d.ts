import type { ParsedDoc, SectionInfo, SectionSettings } from './types';
/** US Letter, portrait, 1-inch margins */
export declare const DEFAULT_SECTION: SectionSettings;
/** Page setup from one w:sectPr XML slice. */
export declare function sectionSettingsFromXml(xml: string): SectionSettings;
/** Read page setup from the trailing (hidden) w:sectPr. */
export declare function readSectionSettings(parsed: ParsedDoc): SectionSettings;
/**
 * Rewrite the sectPr page numbering w:pgNumType (fmt = number format, start = starting
 * page number; undefined fields are omitted, and the tag is removed when both are unset).
 * Schema order: pgNumType comes after pgMar/pgBorders and before cols/docGrid.
 */
export declare function applyPageNumType(sectPrXml: string, fmt: string | undefined, start: number | undefined): string;
/**
 * Enumerate every section in document order. A paragraph-level w:sectPr
 * (section-break paragraph) closes its section; the trailing hidden sectPr closes the last.
 * Block ranges use docxIndex (body child order), boundaries inclusive.
 */
export declare function readSections(parsed: ParsedDoc): SectionInfo[];
/** Rewrite pgSz / pgMar inside a w:sectPr XML slice, preserving everything else. */
export declare function applySectionSettings(sectPrXml: string, settings: SectionSettings): string;
/**
 * Rewrite the sectPr start type w:type (how this section starts relative to the previous
 * one). nextPage is the default and is written by removing the tag; w:type comes before
 * pgSz in CT_SectPr.
 */
export declare function applySectionStartType(sectPrXml: string, type: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage'): string;
/** Read the page color (w:background) from document.xml; null when unset. */
export declare function readPageColor(parsed: ParsedDoc): string | null;
