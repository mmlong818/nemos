import type { ChartDisplay, NewChart } from './types';
/**
 * Read the display model of a chart part (word/charts/chartN.xml). Only the
 * caches Word writes next to the data references (c:strCache / c:numCache)
 * are read — the embedded workbook is never opened. Returns null when the
 * part has no series with cached values (e.g. scatter charts).
 */
export declare function parseChartPartXml(xml: string, partPath: string): ChartDisplay | null;
export declare const CHART_WORKBOOK_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package";
/**
 * Build a complete chart part (word/charts/chartN.xml) from data. The chart
 * references an embedded workbook via c:externalData so Word's "Edit Data" works.
 * Pass `externalDataRId` to wire the c:externalData relationship; omit it when
 * the workbook will be added in a separate step.
 */
export declare function buildChartPartXml(chart: NewChart, externalDataRId?: string): string;
export interface ChartSeriesPatch {
    name?: string;
    /** aligned with ChartSeries.values; null = keep the original value */
    values?: (number | null)[];
}
export interface ChartPatch {
    title?: string;
    /** aligned with ChartDisplay.categories; null = keep */
    categories?: (string | null)[];
    /** aligned with ChartDisplay.series; null = keep that series untouched */
    series?: (ChartSeriesPatch | null)[];
}
/**
 * Patch cached texts/numbers of a chart part while keeping the structure —
 * data references (c:f), styling, layout — byte-identical. Anything the
 * patch cannot anchor (missing title, missing cache point) is left as-is.
 * The embedded workbook is intentionally not touched: Word renders from
 * these caches, but "Edit Data" will show the original sheet numbers.
 */
export declare function patchChartPartXml(xml: string, patch: ChartPatch): string;
/**
 * Build a minimal but valid xlsx file containing one Sheet1 with the chart
 * data (header row + data rows). Returns base64-encoded bytes.
 *
 * Layout:
 *   A1        | B1 (ser 0 name) | C1 (ser 1 name) ...
 *   A2 (cat0) | B2 (val 0,0)    | C2 (val 1,0)   ...
 *   A3 (cat1) | B3 (val 0,1)    | C3 (val 1,1)   ...
 */
export declare function buildChartWorkbookXlsxBase64(categories: string[], series: Array<{
    name: string;
    values: (number | null)[];
}>): Promise<string>;
/**
 * Patch the Sheet1 sheetData inside an embedded xlsx file (base64).
 * Rewrites category column A and each series column with the provided values.
 * Returns the updated base64, or null on failure.
 */
export declare function patchChartWorkbookXlsxBase64(base64: string, categories: string[], series: Array<{
    name: string;
    values: (number | null)[];
}>): Promise<string | null>;
