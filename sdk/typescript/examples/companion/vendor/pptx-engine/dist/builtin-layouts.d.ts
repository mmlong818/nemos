/**
 * Built-in standard slide layouts (PowerPoint's core set).
 *
 * AI-generated decks usually ship a single empty layout, leaving the layout
 * picker useless. These definitions mirror the Office default template's
 * placeholder geometry (16:9 base, scaled to the actual slide size) and are
 * injected into the package on first use: layout part + rels + [Content_Types]
 * override + slideMaster registration (rels + sldLayoutIdLst), so the result
 * is a regular layout PowerPoint also understands.
 */
import type { PackageArchive } from './zip';
import type { SlideSize } from './types';
import { type SlideLayoutInfo } from './layout';
/** Virtual layout-path prefix offered by the UI before the layout exists in the package */
export declare const BUILTIN_LAYOUT_PREFIX = "builtin:";
interface BuiltinPh {
    type: string;
    idx?: string;
    /** Geometry in the Office 16:9 base (12192000×6858000 EMU), scaled to the deck size on use */
    x: number;
    y: number;
    cx: number;
    cy: number;
}
export interface BuiltinLayoutDef {
    key: string;
    /** Canonical <p:cSld name>: PowerPoint's English layout name (the UI localizes known names) */
    name: string;
    /** <p:sldLayout type> */
    type: string;
    placeholders: BuiltinPh[];
}
export declare const BUILTIN_LAYOUTS: BuiltinLayoutDef[];
/**
 * Whether the picker should offer the built-in set: true while no foreign
 * (non-built-in-named) layout carries placeholders. Judging by name keeps
 * already-injected built-ins from turning the offer off — otherwise the rest
 * of the standard set would vanish after the first one is used.
 */
export declare function shouldOfferBuiltinLayouts(layouts: Array<{
    name: string;
    placeholders: unknown[];
}>): boolean;
/**
 * Virtual SlideLayoutInfo entries for the layout picker (path = 'builtin:<key>').
 * Definitions whose canonical name collides with an existing layout are skipped.
 */
export declare function builtinLayoutInfos(size: SlideSize, existingNames: Set<string>): SlideLayoutInfo[];
/**
 * Make sure a built-in layout exists in the package and return its path.
 * Idempotent: an existing layout with the same canonical name is reused.
 * Returns null for an unknown key or a package without a slideMaster.
 */
export declare function ensureBuiltinLayout(archive: PackageArchive, size: SlideSize, key: string): string | null;
export {};
