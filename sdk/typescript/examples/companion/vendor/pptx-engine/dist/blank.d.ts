/** Minimal blank slide XML (empty spTree); insertBlankSlide also uses it as new slide content. */
export declare const BLANK_SLIDE_XML: string;
/** Generate blank presentation bytes (16:9, one blank slide). */
export declare function createBlankPptx(): Promise<Uint8Array>;
