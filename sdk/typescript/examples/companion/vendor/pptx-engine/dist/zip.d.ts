import type { SlideSize } from './types';
export interface Relationship {
    id: string;
    type: string;
    target: string;
    targetMode?: string;
}
export declare class PackageArchive {
    private readonly zip;
    /** Original bytes of every entry, keyed by path inside the zip */
    readonly entries: Map<string, Uint8Array>;
    readonly originalHash: string;
    private constructor();
    static open(bytes: Uint8Array): Promise<PackageArchive>;
    has(path: string): boolean;
    /** Read a part as a UTF-8 string (for XML parts). */
    readText(path: string): string | null;
    readBytes(path: string): Uint8Array | null;
    /**
     * Read a part's relationships file. partPath e.g. 'ppt/slides/slide1.xml' →
     * 'ppt/slides/_rels/slide1.xml.rels'.
     */
    readRels(partPath: string): Map<string, Relationship>;
    /**
     * Read the presentation's slide size and the slide part paths in order.
     */
    readPresentation(): {
        size: SlideSize;
        slidePaths: string[];
    };
    /** Resolve a slide's layout / master part paths (via the rels chain). */
    resolveSlideChain(slidePath: string): {
        layoutPath?: string;
        masterPath?: string;
        themePath?: string;
    };
}
/** 'ppt/slides/slide1.xml' → 'ppt/slides/_rels/slide1.xml.rels' */
export declare function relsPathFor(partPath: string): string;
/**
 * Resolve a relative target into an absolute path inside the zip.
 * basePart is the referencing part's path (its directory is the base); target may be
 * something like '../slideLayouts/slideLayout1.xml'.
 */
export declare function resolveTarget(basePart: string, target: string): string;
