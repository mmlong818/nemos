/** numId of the template's bullet list definition */
export declare const BLANK_BULLET_NUM_ID = "1";
/** numId of the template's ordered (decimal) list definition */
export declare const BLANK_ORDERED_NUM_ID = "2";
/** Custom numbering level (one level of a multilevel list / bullet library / numbering library definition) */
export interface CustomNumberingLevel {
    /** w:numFmt:decimal/bullet/lowerLetter/upperRoman/chineseCountingThousand… */
    numFmt: string;
    /** w:lvlText: a pattern like "%1." or a literal bullet symbol */
    lvlText: string;
    /** w:ind w:left(twips) */
    indentLeft: number;
    /** w:ind w:hanging (twips, default 360) */
    hanging?: number;
    /** w:start (default 1) */
    start?: number;
}
/** One abstractNum definition; uses custom levels when provided, otherwise the blank-template style (5 levels) */
export declare function abstractNumXml(abstractNumId: string, kind: 'bullet' | 'ordered', levels?: CustomNumberingLevel[]): string;
/** The blank template's numbering.xml (bullet numId 1 / decimal numId 2);
 *  base content used when the document has no such part */
export declare const BLANK_NUMBERING_XML: string;
export interface BlankDocxOptions {
    /**
     * docDefaults East Asian font (w:eastAsia); pick per UI language so e.g.
     * Japanese/Korean users don't start with a Simplified-Chinese face.
     * When omitted no w:eastAsia is written — like an en-US Word document,
     * Word/our renderer then substitute per script when CJK text appears.
     */
    eastAsiaFont?: string;
}
/** Build a minimal valid .docx: one empty paragraph, A4 portrait, standard styles. */
export declare function buildBlankDocx(options?: BlankDocxOptions): Promise<Uint8Array>;
