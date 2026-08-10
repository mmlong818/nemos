/**
 * OMML (Office Math Markup) <-> display / authoring support.
 *
 * - ommlFragmentsOf: pull the <m:oMath> fragments out of a paragraph
 * - ommlToMathML: convert OMML to MathML Core for native Chromium rendering
 * - latexToOmml: build OMML from a practical LaTeX subset (insert dialog / gallery)
 */
/** all <m:oMath> fragments of a paragraph, in document order (oMathPara unwrapped) */
export declare function ommlFragmentsOf(paragraphXml: string): string[];
/** visible <m:t> leaf texts in document order (the editable formula tokens) */
export declare function mathTokensOf(xml: string): string[];
/**
 * MathML Core markup for one or more <m:oMath> fragments (they may be passed
 * concatenated). Returns '' when nothing convertible is found.
 */
export declare function ommlToMathML(ommlXml: string): string;
/**
 * Decompile a single <m:oMath> fragment back into the LaTeX subset that
 * latexToOmml accepts. Returns null when the formula uses structures the
 * subset cannot express (the caller then keeps token-level editing only).
 * The result is semantically equivalent, not byte-identical: it is only used
 * when the user actually edits the formula, so regeneration is expected.
 */
export declare function ommlToLatex(ommlXml: string): string | null;
/**
 * Convert a practical LaTeX subset into OMML (the children of <m:oMath>).
 * Supported: \frac \binom \sqrt[n] ^ _ \sum/\int/... with limits,
 * \left(\right), matrix environments, accents, greek letters and common
 * symbols, \text{}, function names. Throws Error (with a Chinese message)
 * on syntax the subset does not cover.
 */
export declare function latexToOmml(latex: string): string;
/** OMML for a display formula paragraph created by the editor */
export declare function mathParagraphXml(omml: string, align?: 'left' | 'center' | 'right'): string;
