/** XML escaping utilities (same as docx-engine's, used for patch generation). */

/**
 * A fast-xml-parser element node: attributes are '@_'-prefixed, text is '#text',
 * child elements are nested nodes (a single child collapses to an object instead
 * of an array). Parse trees are inherently untyped, so readers probe them through
 * the narrowing helpers below instead of `any`.
 */
export type XmlNode = Record<string, unknown>

/** View an unknown parse-tree value as an element node; non-objects read as empty. */
export function asXmlNode(v: unknown): XmlNode {
  return typeof v === 'object' && v !== null ? (v as XmlNode) : {}
}

/** Normalize fast-xml-parser's single-child collapse: always get an array of element nodes. */
export function xmlArray(v: unknown): XmlNode[] {
  if (Array.isArray(v)) return v.map(asXmlNode)
  return v ? [asXmlNode(v)] : []
}

export function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeXmlAttr(text: string): string {
  return escapeXmlText(text).replace(/"/g, '&quot;')
}
