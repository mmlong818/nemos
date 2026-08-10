import type { ThemeColors, ThemeFonts } from './types';
/**
 * Theme part support (word/theme/theme1.xml). Theme fonts rewrite the
 * major/minor font pair; theme colors rewrite the a:clrScheme entries. Documents
 * whose styles reference theme fonts/colors re-render in Word accordingly.
 */
export declare const THEME_PART_PATH = "word/theme/theme1.xml";
export declare const THEME_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
export declare const THEME_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.theme+xml";
/** read the latin/ea/cs major+minor typefaces from theme1.xml */
export declare function readThemeFonts(themeXml: string): ThemeFonts | null;
export declare function applyThemeFonts(themeXml: string, fonts: ThemeFonts): string;
export declare function readThemeColors(themeXml: string): ThemeColors | null;
/**
 * Resolve a w:themeColor reference (+ optional w:themeTint / w:themeShade,
 * hex 00-FF) against the palette. sRGB per-channel approximation of Word's
 * tint/shade math — close enough for display; w:val stays authoritative on save.
 */
export declare function resolveThemeColor(themeColor: string, colors: ThemeColors, tint?: string, shade?: string): string | null;
export declare function applyThemeColors(themeXml: string, colors: ThemeColors): string;
/**
 * Minimal but complete theme part for documents that have none (e.g. the
 * blank template). Word requires fmtScheme; this ships the standard Office
 * format scheme skeleton.
 */
export declare function buildThemeXml(fonts: ThemeFonts, colors: ThemeColors): string;
