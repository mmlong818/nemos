import { XMLParser } from 'fast-xml-parser';
/** preserveOrder node shape from fast-xml-parser */
export type XNode = Record<string, unknown>;
export declare const xmlParser: XMLParser;
export declare function nameOf(node: XNode): string | undefined;
export declare function childrenOf(node: XNode): XNode[];
export declare function attrsOf(node: XNode): Record<string, string>;
export declare function textOf(node: XNode): string;
export declare function findChild(node: XNode, name: string): XNode | undefined;
export declare function findChildren(node: XNode, name: string): XNode[];
/**
 * Direct children with `name`, looking through w:sdt → w:sdtContent wrappers
 * (nested sdt included). Structured document tags may wrap table rows, cells
 * or paragraphs at any level; for display purposes the wrapper is transparent
 * (research-report templates wrap every field in an sdt).
 */
export declare function childrenThroughSdt(node: XNode, name: string | readonly string[]): XNode[];
/** OOXML boolean property: present => true unless w:val says otherwise */
export declare function boolProp(parent: XNode, name: string): boolean;
/**
 * w:u is NOT an OOXML boolean (CT_OnOff) — it is CT_Underline, where the
 * underline pattern lives entirely in w:val. A <w:u> with no w:val (e.g.
 * `<w:u w:color="415461"/>` as emitted by Pages/LibreOffice) means no
 * underline, matching how Word renders it.
 */
export declare function underlineProp(parent: XNode): boolean;
/**
 * XNode → XML text (attribute order = parse order, empty elements self-close). Semantic
 * fidelity, not byte fidelity: used to store parse-tree fragments (e.g. a run's rPr) as
 * writable source slices.
 */
export declare function serializeXNode(node: XNode): string;
export declare function escapeXmlText(text: string): string;
export declare function escapeXmlAttr(text: string): string;
