import { type Theme } from './theme';
export type ChartKind = 'line' | 'bar' | 'pie' | 'area' | 'scatter' | 'radar' | 'unknown';
export interface ChartSeries {
    name?: string;
    /** Series main color #RRGGBB (explicit spPr color; render layer fills in from the theme palette otherwise) */
    color?: string;
    values: Array<number | null>;
    /** Combo chart (e.g. bar+line): the plot type this series belongs to; default = ChartModel.kind */
    plotKind?: 'line' | 'bar' | 'area';
    /** Scatter: x values (c:xVal numeric cache; y values in values). Empty → render layer uses ordinals 1..n */
    xValues?: Array<number | null>;
    /** Line: smoothed curve */
    smooth?: boolean;
    /** Whether to draw data point markers (line defaults to false; scatter/radar default
     *  comes from the style; only set when <c:marker><c:symbol> is explicit) */
    marker?: boolean;
    /** Explicit per-point colors <c:dPt> (common for pies; render layer palette otherwise) */
    pointColors?: Array<string | undefined>;
    /** Combo dual axes: this series is on the secondary value axis (independent right-side range; decided by the plot's c:axId) */
    secondaryAxis?: boolean;
}
export interface ChartAxisStyle {
    /** Explicit min/max (render layer computes a nice range from the data otherwise) */
    min?: number;
    max?: number;
    labelColor?: string;
    labelSizePt?: number;
    lineColor?: string;
    gridColor?: string;
    gridDash?: boolean;
    title?: string;
    /** <c:orientation val="maxMin"/>: categories/values reversed (common for bar charts with the first category on top) */
    reversed?: boolean;
}
export interface ChartModel {
    kind: ChartKind;
    /** bar only: col = vertical columns, bar = horizontal bars */
    barDir?: 'col' | 'bar';
    grouping?: 'clustered' | 'stacked' | 'percentStacked' | 'standard';
    /** Gap between bars (% of bar width, c:gapWidth, default 150) */
    gapWidthPct?: number;
    categories: string[];
    series: ChartSeries[];
    /** Legend position (undefined when there is no c:legend) */
    legendPos?: 't' | 'b' | 'l' | 'r' | 'tr';
    valAxis?: ChartAxisStyle;
    /** Secondary value axis (right side, combo column+line dual axes; undefined without a right value axis or style info) */
    valAxis2?: ChartAxisStyle;
    catAxis?: ChartAxisStyle;
    /** Doughnut hole (% of radius, c:holeSize; pie = 0) */
    holePct?: number;
    /** First slice start angle (degrees, 12 o'clock = 0, clockwise; c:firstSliceAng) */
    firstSliceAngDeg?: number;
    /** Scatter style (c:scatterStyle: line/lineMarker/marker/smooth/smoothMarker/none) */
    scatterStyle?: string;
    /** Radar style (c:radarStyle) */
    radarStyle?: 'standard' | 'marker' | 'filled';
    /** Data labels (showVal or showPercent on plot/ser-level c:dLbls) */
    dataLabels?: boolean;
    /** Data labels show percentages only (showPercent only, common for pies) */
    dataLabelsPct?: boolean;
    /** Chart title (concatenated rich text of c:chart/c:title) */
    title?: string;
}
/** Parse one chartN.xml. Returns null for unrecognized plot types (caller falls back to a placeholder chip). */
export declare function parseChartXml(xml: string, theme?: Theme): ChartModel | null;
