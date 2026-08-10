/**
 * Text watermark support. Word implements watermarks as a VML shape with a
 * v:textpath inside the page header; the shape floats behind the body text
 * on every page that uses that header.
 */
/** namespaces the header part root needs when it carries a VML watermark */
export declare const WATERMARK_NS: string;
/** read the watermark text from a header part; null when it has none */
export declare function readWatermarkText(headerXml: string): string | null;
/**
 * The diagonal gray text watermark paragraph Word generates (shapetype 136 =
 * text-on-path). Lives as the first paragraph of the header part.
 */
export declare function watermarkParagraphXml(text: string): string;
