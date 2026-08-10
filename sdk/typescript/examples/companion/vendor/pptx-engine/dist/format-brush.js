"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractFormat = extractFormat;
exports.applyFormat = applyFormat;
// ── Extraction (source element → CopiedFormat) ─────────────────────────
/**
 * Extract format from a TextElement (type='text'|'shape').
 * Only extracts the "write-back-able" parts; ignores passthrough/group/picture.
 */
function extractFormat(el) {
    const shape = {};
    if (el.fill)
        shape.fill = el.fill;
    if (el.stroke)
        shape.stroke = el.stroke;
    if (el.adjust && Object.keys(el.adjust).length > 0)
        shape.adjust = el.adjust;
    const run = {};
    const para = {};
    const firstPara = el.text?.paragraphs?.[0];
    if (firstPara) {
        if (firstPara.align)
            para.align = firstPara.align;
        const firstRun = firstPara.runs?.[0];
        if (firstRun) {
            if (firstRun.fontFamily != null)
                run.fontFamily = firstRun.fontFamily;
            if (firstRun.fontSize != null)
                run.fontSize = firstRun.fontSize;
            if (firstRun.bold != null)
                run.bold = firstRun.bold;
            if (firstRun.italic != null)
                run.italic = firstRun.italic;
            if (firstRun.underline != null)
                run.underline = firstRun.underline;
            if (firstRun.color != null)
                run.color = firstRun.color;
        }
    }
    return {
        sourceType: el.type,
        shape: Object.keys(shape).length > 0 ? shape : undefined,
        run: Object.keys(run).length > 0 ? run : undefined,
        paragraph: Object.keys(para).length > 0 ? para : undefined,
    };
}
/**
 * Apply a CopiedFormat to the target element and compute the delta to modify.
 * Cross-type application takes the intersection:
 *   - target is picture: apply stroke only (no fill/text)
 *   - target is shape: apply spPr + text run + alignment
 *   - target is text: apply spPr + text run + alignment
 */
function applyFormat(fmt, targetType) {
    const result = {};
    if (targetType === 'picture') {
        // Picture: apply stroke only
        if (fmt.shape?.stroke !== undefined)
            result.stroke = fmt.shape.stroke;
        return result;
    }
    // shape / text: apply everything
    if (fmt.shape?.fill !== undefined)
        result.fill = fmt.shape.fill;
    if (fmt.shape?.stroke !== undefined)
        result.stroke = fmt.shape.stroke;
    if (fmt.run && Object.keys(fmt.run).length > 0)
        result.runFormat = fmt.run;
    if (fmt.paragraph?.align)
        result.align = fmt.paragraph.align;
    return result;
}
