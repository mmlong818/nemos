/**
 * Element-level hyperlinks — <a:hlinkClick> under <p:cNvPr>.
 *
 * Two kinds of targets:
 * - External URL: a hyperlink relationship with TargetMode="External" in the slide rels;
 * - In-document slide jump: hlinkClick with action="ppaction://hlinksldjump",
 *   whose relationship (type=slide) points at the target slideN.xml.
 *
 * Implemented via "XML surgery + materialize": edit the cNvPr in the element's
 * current fragment, then reparse the whole slide (same path as appendRawElements).
 */
import type { Slide } from './types';
import { type OpenedPptx } from './index';
export type LinkTarget = {
    kind: 'url';
    url: string;
} | {
    kind: 'slide';
    slideIndex: number;
};
/**
 * Set/clear an element hyperlink. target=null clears it (the relationship is left
 * orphaned, which is harmless). On success returns the materialized new slide model
 * (all element ids refreshed); on failure returns null.
 */
export declare function setElementLink(opened: OpenedPptx, slideIndex: number, elementId: string, target: LinkTarget | null): Slide | null;
/** Parse a TextRun.hyperlink encoded target ("slide:N" or url); null on bad input. */
export declare function decodeRunLink(s: string): LinkTarget | null;
/** TextRun.hyperlink encoding of a link target. */
export declare function encodeRunLink(target: LinkTarget): string;
/**
 * Allocate slide-rels relationships for runs whose hyperlink was set this session
 * (hyperlink present, hyperlinkRId absent — the edit path clears the rId on change).
 * Cleared links just lose their rId; the old relationship is left orphaned like
 * setElementLink does. Returns whether anything was allocated.
 */
export declare function ensureRunLinkRels(opened: OpenedPptx, slideIndex: number, paragraphs: Array<{
    runs: Array<{
        hyperlink?: string;
        hyperlinkRId?: string;
        hyperlinkAction?: string;
    }>;
}>): boolean;
/**
 * All run-level hyperlinks on a slide, resolved live against the rels (parse-time
 * TextRun.hyperlink can go stale after slide reorders). Keyed by element + paragraph +
 * run indexes; the slideshow matches these against layout glyph runs to hit-test clicks.
 */
export declare function getRunLinks(opened: OpenedPptx, slideIndex: number): Array<{
    elementId: string;
    paraIndex: number;
    runIndex: number;
    target: LinkTarget;
}>;
/** Read an element's current hyperlink (for UI echo-back); returns null if none. */
export declare function getElementLink(opened: OpenedPptx, slideIndex: number, elementId: string): LinkTarget | null;
/**
 * All element hyperlinks on a slide (groups scanned recursively) — the slideshow
 * uses this to hit-test clicks and follow slide jumps (Zoom) / external URLs.
 * Group children have empty anchors (their bytes live only inside the group's
 * fragment), so each child's XML is sliced out of the group XML by index.
 */
export declare function getSlideLinks(opened: OpenedPptx, slideIndex: number): Array<{
    elementId: string;
    target: LinkTarget;
}>;
