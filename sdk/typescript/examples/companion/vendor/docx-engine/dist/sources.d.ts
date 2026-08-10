import type JSZip from 'jszip';
import type { SourceInfo } from './types';
/**
 * Bibliography sources live in a customXml part using the Word b:Sources
 * schema, so sources added here appear in Word's own citation manager.
 */
export declare const SOURCES_NS = "http://schemas.openxmlformats.org/officeDocument/2006/bibliography";
export declare const CUSTOM_XML_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml";
/** find the zip path of the existing b:Sources custom xml part, if any */
export declare function findSourcesPart(zip: JSZip): Promise<string | null>;
export declare function parseSourcesXml(xml: string): SourceInfo[];
/**
 * Surgical rebuild of b:Sources: unchanged b:Source entries keep their original bytes
 * (unmodeled fields like Editor/Volume/Pages/DOI/multi-author lists are preserved), the
 * root element attributes (SelectedStyle citation style) come from the original document,
 * and only new/edited entries are rebuilt from the modeled fields.
 */
export declare function buildSourcesXml(sources: SourceInfo[], originalXml?: string | null): string;
export declare function buildSourcesItemPropsXml(): string;
/** in-text citation, e.g. "(Smith, 2024)" */
export declare function citationText(source: SourceInfo): string;
/** one bibliography line in a simple APA-like format */
export declare function bibliographyLine(source: SourceInfo): string;
