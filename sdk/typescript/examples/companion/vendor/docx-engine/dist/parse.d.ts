import JSZip from 'jszip';
import { type BodyElement } from './scan';
import type { ParsedDoc } from './types';
/**
 * Reject zip bombs before any part is inflated, using the declared
 * uncompressed sizes from the central directory (JSZip keeps them in
 * the lazy `_data` compressed object).
 */
export declare function assertZipWithinLimits(zip: JSZip): void;
export interface ParseExtras {
    /** ranges of top-level body elements, aligned with docxIndex */
    elements: BodyElement[];
    /** original XML of chart parts referenced by chart blocks (partPath -> xml) */
    chartParts: Record<string, string>;
}
export declare function parseDocx(bytes: Uint8Array): Promise<ParsedDoc & {
    extras: ParseExtras;
}>;
