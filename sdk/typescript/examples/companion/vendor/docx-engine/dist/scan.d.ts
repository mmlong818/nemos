/**
 * Byte-exact scanner for word/document.xml.
 *
 * We never re-serialize the whole XML (parse->serialize would silently change
 * untouched bytes: attribute order, self-closing forms, entity forms...).
 * Instead we locate the exact character range of every top-level element in
 * <w:body> so that patch-save can splice new fragments while copying untouched
 * elements as raw original substrings.
 */
export interface BodyElement {
    /** tag name, e.g. "w:p", "w:tbl", "w:sectPr" */
    name: string;
    /** range [start, end) in the document.xml string */
    start: number;
    end: number;
}
export interface BodyScan {
    elements: BodyElement[];
    /** range [innerStart, innerEnd) spanning from the first top-level element start to the last element end */
    innerStart: number;
    innerEnd: number;
}
export declare function scanBody(documentXml: string): BodyScan;
