import { type ParseExtras } from './parse';
import { type CustomNumberingLevel } from './blank';
import type { CommentInfo, DocProtection, GeneratedBlock, HeaderFooter, NewChart, NewImage, NewInkImage, NoteInfo, ParsedDoc, SectionSettings, SourceInfo, ThemeColors, ThemeFonts } from './types';
export type ParsedDocFull = ParsedDoc & {
    extras: ParseExtras;
};
/** Body content in final editor order (hidden trailing elements are appended automatically). */
export type SaveBlock = ({
    kind: 'original';
    docxIndex: number;
} | {
    kind: 'generated';
    block: GeneratedBlock;
}
/** self-contained OOXML fragment created by the editor (e.g. a new table);
 *  docxIndex marks the source block (kept when a section-break paragraph is
 *  rewritten, used to inject per-section header references); replaceImage
 *  swaps the fragment's picture bytes in place (new media part, a:blip
 *  re-pointed) so crop/background-removal keep the original drawing XML */
 | {
    kind: 'xml';
    xml: string;
    docxIndex?: number;
    replaceImage?: {
        base64: string;
        mime: NewImage['mime'];
    };
}
/** a new inline image; bytes become word/media/... + relationship */
 | {
    kind: 'image';
    image: NewImage;
}
/** a new embedded chart; data becomes word/charts/chartN.xml + relationship */
 | {
    kind: 'chart';
    chart: NewChart;
    extentPx?: {
        w: number;
        h: number;
    };
}) & {
    /** Top-level tracked insertion/deletion wrapper. */
    revision?: {
        kind: 'ins' | 'del';
        author: string;
        date?: string;
        id?: string;
    };
};
export interface SaveOptions {
    /** save timestamp (ISO), written to docProps/core.xml dcterms:modified; default = now */
    savedAt?: string;
    /** rewrite page size / margins in the trailing w:sectPr */
    section?: SectionSettings;
    /** last-section start type (w:type); rewrites the trailing sectPr when inserting a continuous section break; undefined = keep */
    sectionStartType?: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage';
    /** last-section page numbering (w:pgNumType): both fmt/start unset = remove the tag; undefined = keep */
    pgNumType?: {
        fmt?: string;
        start?: number;
    };
    /** page color: hex without '#' to set, null to remove, undefined to keep as-is */
    pageColor?: string | null;
    /** replace/create the default page header (single centered line); undefined = keep */
    header?: HeaderFooter;
    /** replace/create the default page footer; undefined = keep */
    footer?: HeaderFooter;
    /** first-page header/footer parts (w:type="first"); undefined = keep */
    headerFirst?: HeaderFooter;
    footerFirst?: HeaderFooter;
    /** even-page header/footer parts (w:type="even"); undefined = keep */
    headerEven?: HeaderFooter;
    footerEven?: HeaderFooter;
    /** "different first page": set/remove w:titlePg in the trailing sectPr */
    titlePg?: boolean;
    /**
     * Per-section header/footer edits (non-last sections of multi-section docs, default
     * variant). lastBlockIndex locates the section's break paragraph: if the section
     * already has a matching reference, the referenced part is rewritten (earlier sections
     * sharing the part change with it — Word's "same as previous" semantics); if there is
     * no reference (inherited from the previous section), a new part is created and the
     * reference injected into this section's sectPr (the section becomes independent,
     * earlier sections are unaffected).
     */
    sectionHf?: Array<{
        lastBlockIndex: number;
        kind: 'header' | 'footer';
        hf: HeaderFooter;
    }>;
    /** "different odd & even pages": set/remove settings.xml w:evenAndOddHeaders */
    evenAndOddHeaders?: boolean;
    /**
     * Append numbering definitions to word/numbering.xml (when the part is missing, it is
     * created from the blank template, including rel/ContentType). newDefs = brand-new
     * abstractNum + w:num (new lists); restartNums = new w:num pointing at an existing
     * abstractNum + startOverride (restart numbering). Append-only: existing entries keep
     * their original bytes.
     */
    numbering?: {
        /** with levels, generates the abstractNum from custom levels (multilevel list / bullet library); otherwise uses the blank-template style */
        newDefs?: Array<{
            numId: string;
            kind: 'bullet' | 'ordered';
            levels?: CustomNumberingLevel[];
        }>;
        restartNums?: Array<{
            numId: string;
            abstractNumId: string;
            startOverrides: Record<number, number>;
        }>;
    };
    /** create/modify styles: surgical upsert of word/styles.xml by styleId (replace when present, else append) */
    styleUpserts?: StyleUpsert[];
    /**
     * Replace whole zip parts by path (e.g. patched chart parts from
     * patchChartPartXml). Only paths that already exist in the package are
     * rewritten; unknown paths are ignored.
     */
    partXml?: Record<string, string>;
    /**
     * Replace whole zip parts with binary data (base64) — used to update
     * embedded xlsx workbooks alongside patched chart parts.
     * Only paths already present in the package are rewritten; unknown paths are
     * ignored.
     */
    partBinary?: Record<string, string>;
    /**
     * Full desired comment list; word/comments.xml is regenerated from it
     * (plain-text bodies). undefined = keep the part byte-identical.
     */
    comments?: CommentInfo[];
    /** editing restriction; null removes w:documentProtection, undefined keeps */
    protection?: DocProtection | null;
    /**
     * Full desired footnote / endnote lists; the part is regenerated from them
     * (separator entries preserved). undefined = keep byte-identical.
     */
    footnotes?: NoteInfo[];
    endnotes?: NoteInfo[];
    /**
     * Text watermark in the default page header: a string sets it, null removes
     * it, undefined keeps whatever the header already has.
     */
    watermark?: string | null;
    /**
     * Full desired ink-annotation list (freehand strokes), as floating anchored pictures.
     * Existing aidocs-ink runs are stripped and re-emitted from this list, so
     * passing [] removes all our ink. undefined = keep whatever is in the file.
     */
    inks?: NewInkImage[];
    /** full bibliography source list; regenerates the b:Sources customXml part */
    sources?: SourceInfo[];
    /** theme font pair; patches (or creates) word/theme/theme1.xml */
    themeFonts?: ThemeFonts;
    /** theme color scheme; patches (or creates) word/theme/theme1.xml */
    themeColors?: ThemeColors;
}
/** Model for creating/modifying a style (used by styleUpserts) */
export interface StyleUpsert {
    styleId: string;
    type: 'paragraph' | 'character';
    name: string;
    basedOn?: string;
    rPr?: {
        bold?: boolean;
        italic?: boolean;
        underline?: boolean;
        strike?: boolean;
        /** hex without '#' */
        color?: string;
        sizeHalfPoints?: number;
        font?: string;
    };
    pPr?: {
        align?: 'left' | 'center' | 'right' | 'justify';
        spaceBeforeTwips?: number;
        spaceAfterTwips?: number;
        /** line spacing as a multiple (auto) */
        lineSpacing?: number;
    };
}
/**
 * Given the original docx bytes and a chart part path (e.g.
 * "word/charts/chart1.xml"), returns the zip-relative path of the embedded
 * workbook (e.g. "word/charts/embeddings/workbook1.xlsx") by reading the
 * chart's rels file, or null when no workbook relationship exists.
 */
export declare function findChartWorkbookPath(docxBytes: Uint8Array, chartPath: string): Promise<string | null>;
/**
 * Read the raw base64 bytes of a zip part from a docx file.
 * Returns null if the part doesn't exist.
 */
export declare function readDocxPartBase64(docxBytes: Uint8Array, path: string): Promise<string | null>;
/**
 * Paragraph-patch save.
 *
 * - Blocks marked 'original' are copied as the exact substring of the original
 *   word/document.xml (byte-for-byte after UTF-8 re-encode).
 * - Blocks marked 'generated' become fresh OOXML fragments referencing only
 *   styles that already exist in the document.
 * - 'xml' blocks are self-contained fragments inserted verbatim; 'image' blocks
 *   additionally add media entries and relationships.
 * - Every other zip entry is copied without modification.
 * - If nothing changed at all, the original file bytes are returned untouched.
 */
export declare function saveDocx(parsed: ParsedDocFull, finalBlocks: SaveBlock[], options?: SaveOptions): Promise<Uint8Array>;
