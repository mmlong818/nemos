import type { NoteInfo } from './types';
/**
 * Footnotes / endnotes part handling (word/footnotes.xml, word/endnotes.xml).
 *
 * Both parts share one schema: a list of w:footnote / w:endnote elements.
 * Entries carrying a w:type attribute (separator, continuationSeparator, ...)
 * are structural and must be preserved; only typeless entries are real notes.
 */
export type NoteKind = 'footnote' | 'endnote';
export declare const NOTE_PART_PATH: Record<NoteKind, string>;
export declare const NOTE_REL_TYPE: Record<NoteKind, string>;
export declare const NOTE_CONTENT_TYPE: Record<NoteKind, string>;
/**
 * Root attributes for a regenerated part. Entries are spliced back in as original bytes, so
 * the root has to keep declaring whatever prefixes those bytes use: Word puts w14:paraId on
 * every paragraph it writes, and a literal namespace list leaves that prefix unbound.
 *
 * `required` lists namespaces the rebuild itself emits (e.g. w14 on rebuilt comments): they
 * are appended when the reused original root does not declare them, since an original from
 * a non-Word producer may bind fewer prefixes than our generated markup uses.
 */
export declare function rootAttributes(originalXml: string | null, rootTag: string, fallback: string, required?: Record<string, string>): string;
/** real notes (separator entries excluded), in file order */
export declare function parseNotesXml(xml: string, kind: NoteKind): NoteInfo[];
/**
 * Regenerate the notes part from the full desired list. Structural entries
 * (separator/continuation) from the original part are kept byte-identical;
 * when there is no original part, standard separators are created.
 * Surgical: existing entries whose text is unchanged keep their original bytes (inline
 * formatting, images, and hyperlinks are preserved); entries with changed text first try
 * an in-paragraph w:t-level patch (formatting still preserved), and only fall back to a
 * plain-text rebuild when patching fails (paragraph count changed, etc.).
 */
export declare function buildNotesXml(kind: NoteKind, notes: NoteInfo[], originalXml: string | null): string;
/** next free numeric note id (separator ids -1/0 and existing notes considered) */
export declare function nextNoteId(notes: NoteInfo[]): string;
