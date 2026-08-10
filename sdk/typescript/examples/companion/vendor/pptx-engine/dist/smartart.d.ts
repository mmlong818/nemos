/**
 * SmartArt (simplified) — instead of writing real diagram parts (the
 * data/layout/colors/quickStyle quartet is too heavy), generate a <p:grpSp> shape
 * group from a preset layout; it is freely editable and is just a plain shape group
 * in PowerPoint.
 *
 * Supported layouts: list (vertical list) / process (horizontal flow) / cycle /
 * hierarchy / pyramid / matrix / venn.
 */
import type { EmuRect, Slide } from './types';
import { type OpenedPptx } from './index';
import { type SmartArtLayout } from './smartart-layout';
export type { SmartArtLayout } from './smartart-layout';
export interface NewSmartArtOptions {
    layout: SmartArtLayout;
    /** Text for each node (determines node count, 1..8) */
    items: string[];
    offset: EmuRect;
}
/** Build the grpSp group fragment. */
export declare function buildSmartArtXml(slide: Slide, opts: NewSmartArtOptions): string;
/** Insert SmartArt (shape-group version): append + reparse, returning the new slide and element id. */
export declare function addSmartArt(opened: OpenedPptx, slideIndex: number, opts: NewSmartArtOptions): {
    slide: Slide;
    elementId: string;
} | null;
