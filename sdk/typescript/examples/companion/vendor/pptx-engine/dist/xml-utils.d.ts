/** XML escaping utilities (same as docx-engine's, used for patch generation). */
/**
 * A fast-xml-parser element node: attributes are '@_'-prefixed, text is '#text',
 * child elements are nested nodes (a single child collapses to an object instead
 * of an array). Parse trees are inherently untyped, so readers probe them through
 * the narrowing helpers below instead of `any`.
 */
export type XmlNode = Record<string, unknown>;
/** View an unknown parse-tree value as an element node; non-objects read as empty. */
export declare function asXmlNode(v: unknown): XmlNode;
/** Normalize fast-xml-parser's single-child collapse: always get an array of element nodes. */
export declare function xmlArray(v: unknown): XmlNode[];
export declare function escapeXmlText(text: string): string;
export declare function escapeXmlAttr(text: string): string;
