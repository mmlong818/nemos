/**
 * Format Painter — pure functions with no side effects, easy to unit test.
 *
 * Format scope:
 *  - Shapes/text boxes: the modelable part of spPr (fill / stroke / presetGeometry / adjust)
 *  - Text: default run format (fontFamily/fontSize/bold/italic/underline/color of the
 *          first run of the first paragraph) + paragraph alignment (first paragraph's align)
 *  - Cross-type: text→shape applies only the spPr part; shape→text applies only the text part
 *
 * Uses the existing editFill / editStroke / editText IPC channels; the caller takes the
 * CopiedFormat to the target element and calls each patch function field by field.
 */
import type { Fill, Stroke, TextElement } from './types';
/** Copied shape appearance format (spPr layer) */
export interface ShapeFormat {
    fill?: Fill;
    stroke?: Stroke;
    /** Corner-radius adjustments for preset geometry such as roundRect */
    adjust?: Record<string, number>;
}
/** Copied default text run format (first run of the first paragraph) */
export interface TextRunFormat {
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    color?: string;
}
/** Copied paragraph format (first paragraph) */
export interface ParagraphFormat {
    align?: 'left' | 'center' | 'right' | 'justify';
}
/** Full container of formats copied by the format painter */
export interface CopiedFormat {
    /** Source element type */
    sourceType: 'text' | 'shape' | 'picture';
    shape?: ShapeFormat;
    run?: TextRunFormat;
    paragraph?: ParagraphFormat;
}
/**
 * Extract format from a TextElement (type='text'|'shape').
 * Only extracts the "write-back-able" parts; ignores passthrough/group/picture.
 */
export declare function extractFormat(el: TextElement): CopiedFormat;
export interface FormatPatchResult {
    /** Fill change (undefined = no change) */
    fill?: Fill;
    /** Stroke change (undefined = no change; null = remove stroke) */
    stroke?: Fill extends Fill ? Stroke | null : Stroke | null;
    /** Text run change (undefined = no change) */
    runFormat?: TextRunFormat;
    /** Paragraph alignment change (undefined = no change) */
    align?: 'left' | 'center' | 'right' | 'justify';
}
/**
 * Apply a CopiedFormat to the target element and compute the delta to modify.
 * Cross-type application takes the intersection:
 *   - target is picture: apply stroke only (no fill/text)
 *   - target is shape: apply spPr + text run + alignment
 *   - target is text: apply spPr + text run + alignment
 */
export declare function applyFormat(fmt: CopiedFormat, targetType: 'text' | 'shape' | 'picture'): FormatPatchResult;
