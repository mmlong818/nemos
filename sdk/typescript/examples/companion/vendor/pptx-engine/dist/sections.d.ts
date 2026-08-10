import type { OpenedPptx } from './index';
export interface SectionInfo {
    /** Section GUID (with braces, PowerPoint style) */
    id: string;
    name: string;
    /** Indices in deck.slides of the slides in this section (in slide order) */
    slideIndices: number[];
}
/**
 * Parse presentation.xml's p14:sectionLst. Returns [] if there are no sections
 * (older documents). sldIds referencing deleted slides are silently skipped.
 */
export declare function getSections(opened: OpenedPptx): SectionInfo[];
/**
 * Write the section structure back into presentation.xml's extLst (created if
 * missing). With empty sections the whole sectionLst extension is removed (and
 * the extLst too if it becomes empty). Only presentation.xml is touched;
 * [Content_Types]/rels are unaffected.
 */
export declare function setSections(opened: OpenedPptx, sections: SectionInfo[]): void;
/**
 * Positional normalization: each section's start = its minimum index (empty
 * sections take the next section's start), section i covers
 * [starts[i], starts[i+1]), the last section runs to total. Returns the
 * unsectioned leading slides + the normalized sections.
 */
export declare function normalizeSections(sections: SectionInfo[], total: number): {
    lead: number[];
    starts: number[];
    sections: SectionInfo[];
};
/**
 * Add a section before slide atSlideIndex (covering atSlideIndex through the end
 * of its containing section). For documents without sections: slides before
 * atSlideIndex go into an auto-created "default section".
 * Returns the updated section list; null for an invalid index.
 */
export declare function addSection(opened: OpenedPptx, atSlideIndex: number, name: string): SectionInfo[] | null;
/** Rename a section; returns null if the id does not exist. */
export declare function renameSection(opened: OpenedPptx, id: string, name: string): SectionInfo[] | null;
/**
 * Delete a section but keep its slides: the section's slides merge into the
 * previous section (or the next one for the first section); when no sections
 * remain the whole sectionLst is removed. Returns null if the id does not exist.
 */
export declare function removeSection(opened: OpenedPptx, id: string, _opts?: {
    keepSlides?: boolean;
}): SectionInfo[] | null;
/**
 * Move slide fromIndex to toIndex (the insertion index after removal, i.e.
 * drag-drop semantics). Keeps presentation.xml's sldIdLst order and deck.slides
 * in sync; with sections, the moved slide joins the section at the drop position
 * (a section emptied by the move stays as an empty section).
 */
export declare function moveSlide(opened: OpenedPptx, fromIndex: number, toIndex: number): boolean;
/**
 * Move a whole section up/down: swaps places with the adjacent section, keeping
 * presentation.xml's sldIdLst order and deck.slides order in sync (unsectioned
 * leading slides stay pinned at the front). Returns the updated section list.
 */
export declare function moveSection(opened: OpenedPptx, id: string, dir: 'up' | 'down'): SectionInfo[] | null;
