/**
 * Chart insertion — writes the chart part (ppt/charts/chartN.xml) + Content_Types
 * Override + slide rels + graphicFrame fragment, going through appendRawElements to
 * reuse the existing chart parsing/rendering.
 *
 * The chartSpace template mirrors docx-engine's buildChartPartXml (data goes through
 * strCache/numCache caches, no embedded workbook attached; PowerPoint renders it
 * fine, but "Edit Data" is unavailable).
 */
import type { EmuRect, Slide } from './types';
import { type OpenedPptx } from './index';
export type NewChartKind = 'bar' | 'barStacked'
/** Percent-stacked column (no insert entry point; used to preserve the type subdivision when rebuilding an externally created chart during edits) */
 | 'barPercentStacked' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter' | 'radar'
/** Combo chart: first N-1 series as clustered columns, last series as a line (on the right secondary value axis) */
 | 'comboBarLine';
/** Chart element/style toggles (unset = current defaults: legend at bottom, no gridlines, no data labels). */
export interface ChartStyleOptions {
    /** Legend position; 'none' = do not write c:legend */
    legendPos?: 'b' | 't' | 'r' | 'l' | 'none';
    /** Data labels (plot-level c:dLbls showVal) */
    dataLabels?: boolean;
    /** Major gridlines on the value axis */
    gridlines?: boolean;
    catAxisTitle?: string;
    valAxisTitle?: string;
    /** Gap between bars (% of bar width, c:gapWidth, PowerPoint default 150) */
    gapWidthPct?: number;
}
export interface NewChartOptions extends ChartStyleOptions {
    kind: NewChartKind;
    title?: string;
    categories: string[];
    series: Array<{
        name: string;
        values: number[];
    }>;
    offset: EmuRect;
    /** Bar direction (bar = horizontal bar chart; no insert entry point, used to preserve the direction when rebuilding an externally created chart during edits) */
    barDir?: 'col' | 'bar';
    /** Per-point fills, [seriesIdx][pointIdx] (sparse; written as <c:dPt>, wins over the series color) */
    pointColors?: Array<Array<string | undefined> | undefined>;
}
/** Full c:chartSpace part XML. */
export declare function buildChartSpaceXml(opts: NewChartOptions): string;
/**
 * Insert a chart: part surgery + graphicFrame fragment append + reparse.
 * Returns the new slide and element id (all ids on the slide refreshed).
 */
export declare function addChart(opened: OpenedPptx, slideIndex: number, opts: NewChartOptions): {
    slide: Slide;
    elementId: string;
} | null;
