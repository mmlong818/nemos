import type { EmuRect, Slide } from './types';
import { type OpenedPptx } from './index';
/** Generate a w×h solid-color PNG (RGB, no alpha). Used as a poster frame placeholder. */
export declare function solidPng(w: number, h: number, rgb: [number, number, number]): Buffer;
export interface NewMediaOptions {
    kind: 'video' | 'audio';
    bytes: Uint8Array;
    /** Lowercase extension (mp4/mov/webm/mp3/wav/m4a…) */
    ext: string;
    /** Poster frame (defaults to a generated solid-color placeholder PNG) */
    poster?: {
        bytes: Uint8Array;
        ext: string;
    };
    offset: EmuRect;
    /** cNvPr name (defaults to a filename-style name) */
    name?: string;
}
/** Insert audio/video: media/poster parts + dual relationships + <p:pic> fragment, append + reparse. */
export declare function addMedia(opened: OpenedPptx, slideIndex: number, opts: NewMediaOptions): {
    slide: Slide;
    elementId: string;
} | null;
export interface NewModel3dOptions {
    bytes: Uint8Array;
    /** glb/gltf */
    ext: string;
    /** Poster image (dark gray placeholder by default) */
    poster?: {
        bytes: Uint8Array;
        ext: string;
    };
    offset: EmuRect;
    name?: string;
}
/**
 * Embed a 3D model: model bytes go into the package (PowerPoint preserves unknown
 * parts) + a poster placeholder image element; descr records
 * `aislides-3d:{partPath}` for recognition on reopen. No am3d extension is written.
 */
export declare function addModel3d(opened: OpenedPptx, slideIndex: number, opts: NewModel3dOptions): {
    slide: Slide;
    elementId: string;
} | null;
/** Check whether a picture element is a 3D model placeholder (for render-layer badges). */
export declare function model3dPartOf(el: {
    descr?: string;
}): string | null;
