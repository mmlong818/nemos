/**
 * Color node resolution (srgbClr/schemeClr/sysClr + lumMod/lumOff/tint/shade/alpha modifiers).
 * Extracted from parse.ts into a shared module: used by both parse (run/fill colors) and
 * placeholder (lstStyle defRPr default colors) to avoid a circular dependency.
 */
import { type Theme } from './theme';
import { type XmlNode } from './xml-utils';
/**
 * Resolve a color node + modifiers: srgbClr/schemeClr/sysClr, supporting alpha
 * (→#RRGGBBAA) and lumMod/lumOff (tint/shade, common for theme colors).
 */
export declare function resolveColorNode(node: unknown, theme: Theme | undefined, phClr?: string): string | undefined;
/** Apply lumMod/lumOff/tint/shade/satMod/alpha modifiers (percentages, in units of 1/1000%). */
export declare function applyColorMods(hex: string, mods: XmlNode | undefined): string;
export declare function hexToRgb(hex: string): {
    r: number;
    g: number;
    b: number;
};
