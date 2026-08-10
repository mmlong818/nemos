/**
 * Speaker notes (notesSlide) read/write — archive surgery, same approach as
 * duplicateSlide.
 *
 * - Read: slide rels → notesSlide part → body placeholder <a:t> text (\n-separated).
 * - Write: patch the existing notesSlide's body txBody; if there is no notesSlide,
 *   create one (creating a notesMaster too if needed and registering it in
 *   presentation.xml).
 * All changes land in archive.entries: savePptx persists automatically, and the
 * main process's snapshot-style undo (shallow copy of entries) covers them.
 */
import type { OpenedPptx } from './index';
import { type PackageArchive } from './zip';
/** Unescape XML text (for reading <a:t>). */
export declare function unescapeXml(s: string): string;
/** Path of the slide's notesSlide part (null if there is no notes slide). */
export declare function notesPathForSlide(archive: PackageArchive, slidePath: string): string | null;
/** Read notes as plain text (body placeholder paragraphs joined by \n); '' if none. */
export declare function getSlideNotes(archive: PackageArchive, slidePath: string): string;
/**
 * Write notes (overwrite): patch the existing notesSlide's body txBody;
 * if there is no notesSlide, create the part (with a notesMaster if needed).
 */
export declare function setSlideNotes(opened: OpenedPptx, slideIndex: number, text: string): boolean;
/** Append a relationship to a part's rels, creating the rels file if missing. Returns the new rId. */
export declare function appendRelationship(archive: PackageArchive, partPath: string, type: string, target: string): string;
