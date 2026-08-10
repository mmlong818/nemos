import { PackageArchive, type Relationship } from './zip';
export interface SlideBundleRel {
    readonly id: string;
    readonly type: string;
    /** absolute source path for internal targets; the raw target for external ones */
    readonly target: string;
    readonly external?: boolean;
    /** true for the slideLayout rel, which the destination re-points */
    readonly layout?: boolean;
}
/** The source layout→master→theme chain, for "keep source formatting" pastes. */
export interface SlideBundleChain {
    readonly layoutPath: string;
    readonly masterPath: string;
    readonly themePath?: string;
    /** the chain parts and everything they reference, base64 like `parts` */
    readonly parts: Readonly<Record<string, string>>;
    readonly contentTypes: Readonly<Record<string, string>>;
}
export interface SlideBundle {
    readonly slideXml: string;
    readonly rels: readonly SlideBundleRel[];
    /** every dependency part, base64 so the bundle survives IPC and JSON */
    readonly parts: Readonly<Record<string, string>>;
    /** ContentType per dependency: keyed by lower-case extension or by part path */
    readonly contentTypes: Readonly<Record<string, string>>;
    /** cSld/@name of the source layout, used to find its counterpart by name */
    readonly layoutName?: string;
    /** source deck's slide size, so the caller can warn about a mismatch */
    readonly slideSize?: {
        cx: number;
        cy: number;
    };
    readonly chain?: SlideBundleChain;
}
/**
 * Snapshot a slide and its dependencies. `slideXml` is passed in so callers can
 * hand over the patched (unsaved-edits-included) XML.
 */
export declare function collectSlideBundle(archive: PackageArchive, slidePath: string, slideXml: string): SlideBundle;
/** All layout paths in the target, with their display names. */
export declare function listLayouts(archive: PackageArchive): {
    path: string;
    name?: string;
}[];
export declare function materializeSlideBundle(archive: PackageArchive, bundle: SlideBundle, slidePath: string, layoutPath: string): string;
/**
 * "Keep source formatting": land the bundled layout→master→theme chain in the
 * target (registering the master) and return the layout path the pasted slide
 * should point at. Returns null when the bundle has no chain or the target's
 * presentation.xml can't take another master — callers fall back to chooseLayout.
 */
export declare function importSourceLayout(archive: PackageArchive, bundle: SlideBundle): string | null;
/** The destination layout for a pasted slide: same name first, else the neighbour's. */
export declare function chooseLayout(archive: PackageArchive, bundle: SlideBundle, neighbourSlidePath?: string): string | null;
export type { Relationship };
