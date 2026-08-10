/**
 * Byte-level scanner for slideN.xml.
 *
 * Same idea as docx-engine.scanBody: never parse->serialize (that silently alters
 * untouched bytes: attribute order, self-closing form, entity encoding). Only locate
 * the exact character range of each top-level shape inside <p:spTree>
 * (p:sp / p:pic / p:graphicFrame / p:grpSp / p:cxnSp); on save, splice in new
 * fragments and copy unmodified shapes verbatim from the original substring.
 *
 * The leading <p:nvGrpSpPr> / <p:grpSpPr> inside spTree are not shapes; they go
 * into bodyPrefix.
 */
export interface SpElement {
    /** tag: p:sp / p:pic / p:graphicFrame / p:grpSp / p:cxnSp */
    name: string;
    /** range [start, end) in slideN.xml string */
    start: number;
    end: number;
    /** Raw bytes between this shape and the next non-adjacent shape (mc:AlternateContent / p:contentPart etc.), replayed verbatim on rebuild */
    gapAfter?: string;
}
export interface SlideScan {
    elements: SpElement[];
    /** From the start of <p:spTree> up to the first shape (spTree open tag + nvGrpSpPr/grpSpPr) */
    bodyPrefix: string;
    /** From the end of the last shape to the end of the file (</p:spTree> and trailing content) */
    bodySuffix: string;
}
export declare function scanSlide(slideXml: string): SlideScan;
