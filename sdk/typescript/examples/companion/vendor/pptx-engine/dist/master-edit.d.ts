/**
 * Slide master / layout edit view support (6.16).
 *
 * Exception to the fidelity rule: only layout/master parts the user actively edited
 * in master view are written back, reusing the slide byte-surgery path (scanSlide
 * anchors + patchSlideXml); untouched elements pass through with original bytes.
 * This module only enumerates and parses; the caller writes back via patchSlideXml
 * and then writes the archive entry.
 */
import type { PackageArchive } from './zip';
import type { Slide } from './types';
export interface MasterPartInfo {
    /** Path inside the zip, e.g. ppt/slideMasters/slideMaster1.xml */
    partPath: string;
    kind: 'master' | 'layout';
    /** <p:cSld name="…">, falling back to the file name */
    name: string;
}
/** Enumerate parts for the master edit view: each master first, followed by its layouts. */
export declare function listMasterParts(archive: PackageArchive): MasterPartInfo[];
/**
 * Parse a layout/master part into an editable Slide (its spTree structure is isomorphic
 * to a slide's, so scanSlide applies directly).
 * - master: text styles come from its own <p:txStyles>; placeholders always have an
 *   explicit xfrm, so no geometry inheritance is needed.
 * - layout: placeholder geometry/text styles/background inherit from its master; the
 *   master decoration layer is rendered underneath.
 */
export declare function parseMasterPart(archive: PackageArchive, partPath: string): Slide | null;
