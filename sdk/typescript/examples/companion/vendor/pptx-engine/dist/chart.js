"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseChartXml = parseChartXml;
/**
 * Chart parsing (ppt/charts/chartN.xml → ChartModel).
 *
 * Read-only semantic parsing: on a slide a chart is a separate part referenced by
 * a <p:graphicFrame>; byte fidelity is guaranteed by passing the graphicFrame's
 * anchor bytes through verbatim, and the chart part is never rewritten.
 *
 * Supports data + explicit styling (series colors, axis label styles, gridlines)
 * for lineChart / barChart (incl. horizontal bars) / pieChart (incl. doughnut) /
 * areaChart / scatterChart / radarChart; missing styles fall back to the theme
 * palette. bar/area/line can be combined in one plotArea (column+line combo);
 * combined series carry plotKind and the primary type is picked bar > area > line;
 * series on the secondary value axis (axPos=r, not deleted, matched by the plot's
 * c:axId) carry secondaryAxis, with the secondary axis style/range parsed into
 * valAxis2.
 */
const fast_xml_parser_1 = require("fast-xml-parser");
const color_1 = require("./color");
const chartParser = new fast_xml_parser_1.XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: false,
    parseTagValue: false,
    isArray: (name) => ['c:ser', 'c:pt', 'c:lvl', 'c:dPt'].includes(name),
});
/** Parse one chartN.xml. Returns null for unrecognized plot types (caller falls back to a placeholder chip). */
function parseChartXml(xml, theme) {
    let doc;
    try {
        doc = chartParser.parse(xml);
    }
    catch {
        return null;
    }
    const chart = doc['c:chartSpace']?.['c:chart'];
    const plotArea = chart?.['c:plotArea'];
    if (!plotArea)
        return null;
    // Cartesian types (bar/area/line) may coexist combined (e.g. column+line combo); pie/scatter/radar stand alone.
    const cartesian = [];
    if (plotArea['c:barChart'])
        cartesian.push({ kind: 'bar', plot: plotArea['c:barChart'] });
    if (plotArea['c:areaChart'])
        cartesian.push({ kind: 'area', plot: plotArea['c:areaChart'] });
    if (plotArea['c:lineChart'])
        cartesian.push({ kind: 'line', plot: plotArea['c:lineChart'] });
    let kind;
    let plot;
    if (cartesian.length) {
        // Primary type is the first (bar > area > line): axis/bar params read from it; other combo series carry plotKind
        kind = cartesian[0].kind;
        plot = cartesian[0].plot;
    }
    else if (plotArea['c:pieChart'] || plotArea['c:doughnutChart']) {
        kind = 'pie';
        plot = plotArea['c:pieChart'] ?? plotArea['c:doughnutChart'];
    }
    else if (plotArea['c:scatterChart']) {
        kind = 'scatter';
        plot = plotArea['c:scatterChart'];
    }
    else if (plotArea['c:radarChart']) {
        kind = 'radar';
        plot = plotArea['c:radarChart'];
    }
    else {
        return null;
    }
    // Extract value axis nodes up front: combo dual axes need the secondary value
    // axis's axId (axPos=r and not deleted) first, so series parsing can decide
    // "primary or secondary axis" by the owning plot's c:axId
    const valAxRaw = plotArea['c:valAx'];
    const valAxes = Array.isArray(valAxRaw) ? valAxRaw : valAxRaw ? [valAxRaw] : [];
    const secValAxNode = kind !== 'scatter' && cartesian.length > 1
        ? valAxes.find((a) => a?.['c:axPos']?.['@_val'] === 'r' && a?.['c:delete']?.['@_val'] !== '1')
        : undefined;
    const secAxId = secValAxNode?.['c:axId']?.['@_val'];
    // Axes attached to a plot node (two c:axIds: category axis + value axis)
    const plotAxIds = (plotNode) => {
        const raw = plotNode?.['c:axId'];
        const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
        return arr.map((a) => a?.['@_val']).filter((v) => v != null);
    };
    const series = [];
    let categories = [];
    const parsePlotSeries = (plotNode, plotKind, tagPlotKind, secondary = false) => {
        const sersRaw = plotNode['c:ser'];
        const sers = Array.isArray(sersRaw) ? sersRaw : sersRaw ? [sersRaw] : [];
        for (const ser of sers) {
            // Scatter: y values in c:yVal, x values in c:xVal; other types use c:val
            const s = { values: readNumPoints(plotKind === 'scatter' ? ser['c:yVal'] : ser['c:val']) };
            if (tagPlotKind)
                s.plotKind = plotKind;
            if (secondary)
                s.secondaryAxis = true;
            if (plotKind === 'scatter') {
                const xs = readNumPoints(ser['c:xVal']);
                if (xs.length)
                    s.xValues = xs;
            }
            const name = readStrPoints(ser['c:tx'])[0];
            if (name != null)
                s.name = name;
            const color = serColor(ser, theme);
            if (color)
                s.color = color;
            if (ser['c:smooth']?.['@_val'] === '1')
                s.smooth = true;
            const markerSym = ser['c:marker']?.['c:symbol']?.['@_val'];
            if (plotKind === 'line')
                s.marker = markerSym != null && markerSym !== 'none';
            // scatter/radar: default marker decided by style; only set for explicit symbol (none → false)
            else if ((plotKind === 'scatter' || plotKind === 'radar') && markerSym != null)
                s.marker = markerSym !== 'none';
            // Per-data-point colors (one color per pie slice)
            const dPts = ser['c:dPt'] ?? [];
            if (dPts.length) {
                const pointColors = [];
                for (const dPt of dPts) {
                    const idx = parseInt(dPt['c:idx']?.['@_val'], 10);
                    if (Number.isNaN(idx))
                        continue;
                    const c = (0, color_1.resolveColorNode)(dPt['c:spPr']?.['a:solidFill'], theme);
                    if (c != null)
                        pointColors[idx] = c;
                }
                if (pointColors.length)
                    s.pointColors = pointColors;
            }
            series.push(s);
            // Categories: take the first non-empty series' cat
            if (!categories.length)
                categories = readStrPoints(ser['c:cat']);
        }
    };
    if (cartesian.length > 1) {
        for (const c of cartesian)
            parsePlotSeries(c.plot, c.kind, true, secAxId != null && plotAxIds(c.plot).includes(secAxId));
    }
    else
        parsePlotSeries(plot, kind, false);
    if (!series.length)
        return null;
    if (!categories.length) {
        // With no category cache, keep names empty (length from the longest series); never inject placeholders
        const n = Math.max(...series.map((s) => s.values.length), 0);
        categories = Array.from({ length: n }, () => '');
    }
    const model = { kind, categories, series };
    if (kind === 'bar') {
        const dir = plot['c:barDir']?.['@_val'];
        model.barDir = dir === 'bar' ? 'bar' : 'col';
        const grouping = plot['c:grouping']?.['@_val'];
        if (grouping)
            model.grouping = grouping;
        const gap = plot['c:gapWidth']?.['@_val'];
        model.gapWidthPct = gap != null ? parseInt(gap, 10) : 150;
    }
    if (kind === 'pie') {
        const hole = plot['c:holeSize']?.['@_val'];
        model.holePct = hole != null ? parseInt(hole, 10) || 0 : plotArea['c:doughnutChart'] ? 50 : 0;
        const first = plot['c:firstSliceAng']?.['@_val'];
        if (first != null)
            model.firstSliceAngDeg = parseInt(first, 10) || 0;
    }
    if (kind === 'scatter') {
        const st = plot['c:scatterStyle']?.['@_val'];
        if (st)
            model.scatterStyle = String(st);
    }
    if (kind === 'radar') {
        const st = plot['c:radarStyle']?.['@_val'];
        model.radarStyle = st === 'filled' ? 'filled' : st === 'marker' ? 'marker' : 'standard';
    }
    const legendPos = chart['c:legend']?.['c:legendPos']?.['@_val'];
    if (chart['c:legend'])
        model.legendPos = legendPos ?? 'r';
    const chartTitle = collectText(chart['c:title']?.['c:tx']?.['c:rich']);
    if (chartTitle)
        model.title = chartTitle;
    // Data labels: plot-level or any series-level c:dLbls (delete=1 counts as none)
    const dLblsInfo = (owner) => {
        const d = owner?.['c:dLbls'];
        if (!d || typeof d !== 'object' || d['c:delete']?.['@_val'] === '1')
            return { on: false, pct: false };
        const showVal = d['c:showVal']?.['@_val'] === '1';
        const showPct = d['c:showPercent']?.['@_val'] === '1';
        return { on: showVal || showPct, pct: showPct && !showVal };
    };
    const dLblOwners = (cartesian.length > 1 ? cartesian.map((c) => c.plot) : [plot]).flatMap((p) => [p, ...(Array.isArray(p['c:ser']) ? p['c:ser'] : p['c:ser'] ? [p['c:ser']] : [])]);
    const found = dLblOwners.map(dLblsInfo).find((r) => r.on);
    if (found) {
        model.dataLabels = true;
        if (found.pct)
            model.dataLabelsPct = true;
    }
    // Axes: scatter charts have dual value axes (x at the bottom axPos=b, y on the left); the x axis goes in the catAxis slot
    if (kind === 'scatter' && valAxes.length >= 2) {
        const xAxNode = valAxes.find((a) => a?.['c:axPos']?.['@_val'] === 'b') ?? valAxes[0];
        const yAxNode = valAxes.find((a) => a !== xAxNode) ?? valAxes[1];
        const xAx = parseAxis(xAxNode, theme);
        if (xAx)
            model.catAxis = xAx;
        const yAx = parseAxis(yAxNode, theme);
        if (yAx)
            model.valAxis = yAx;
    }
    else {
        // A combo chart (column + line secondary axis) has two axis pairs in plotArea:
        // the value axis is the left primary (axPos=l), the category axis is the
        // non-deleted one (c:delete≠1); the secondary system's hidden category axis is skipped
        const valAxNode = valAxes.find((a) => a?.['c:axPos']?.['@_val'] === 'l') ?? valAxes[0];
        const valAx = parseAxis(valAxNode, theme);
        if (valAx)
            model.valAxis = valAx;
        // Secondary value axis (combo dual axes): min/max/style handed to the render layer to draw the right-side ticks
        if (secValAxNode) {
            const valAx2 = parseAxis(secValAxNode, theme);
            if (valAx2)
                model.valAxis2 = valAx2;
        }
        const catAxRaw = plotArea['c:catAx'];
        const catAxes = Array.isArray(catAxRaw) ? catAxRaw : catAxRaw ? [catAxRaw] : [];
        const catAxNode = catAxes.find((a) => a?.['c:delete']?.['@_val'] !== '1') ?? catAxes[0];
        const catAx = parseAxis(catAxNode, theme);
        if (catAx)
            model.catAxis = catAx;
    }
    return model;
}
/** Numeric cache inside <c:val>/<c:cat>/<c:tx> → number[] (idx order kept, empty points null). */
function readNumPoints(node) {
    const cache = node?.['c:numRef']?.['c:numCache'] ?? node?.['c:numLit'];
    if (!cache)
        return [];
    return readPoints(cache).map((v) => {
        if (v == null || v === '')
            return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    });
}
/** String cache (strRef/strCache or the innermost lvl of multiLvlStrRef) → string[]. */
function readStrPoints(node) {
    const strCache = node?.['c:strRef']?.['c:strCache'];
    if (strCache)
        return readPoints(strCache).map((v) => v ?? '');
    const multi = node?.['c:multiLvlStrRef']?.['c:multiLvlStrCache'];
    if (multi) {
        const lvls = Array.isArray(multi['c:lvl']) ? multi['c:lvl'] : multi['c:lvl'] ? [multi['c:lvl']] : [];
        // The innermost (first lvl) holds the leaf categories
        if (lvls.length)
            return readPoints(lvls[0]).map((v) => v ?? '');
    }
    const numCache = node?.['c:numRef']?.['c:numCache'];
    if (numCache)
        return readPoints(numCache).map((v) => v ?? '');
    return [];
}
/** c:pt list → value array ordered by idx. */
function readPoints(cache) {
    const ptsRaw = cache?.['c:pt'];
    const pts = Array.isArray(ptsRaw) ? ptsRaw : ptsRaw ? [ptsRaw] : [];
    const count = cache?.['c:ptCount']?.['@_val'];
    const n = count != null ? parseInt(count, 10) : pts.length;
    const out = new Array(Math.max(n, pts.length)).fill(null);
    for (const pt of pts) {
        const idx = parseInt(pt['@_idx'], 10) || 0;
        const v = pt['c:v'];
        out[idx] = typeof v === 'string' ? v : v != null ? String(v['#text'] ?? v) : null;
    }
    return out;
}
/** Series main color: ln stroke first (lines), otherwise solidFill (bars/pies). */
function serColor(ser, theme) {
    const spPr = ser['c:spPr'];
    if (!spPr)
        return undefined;
    const lnColor = (0, color_1.resolveColorNode)(spPr['a:ln']?.['a:solidFill'], theme);
    const fillColor = (0, color_1.resolveColorNode)(spPr['a:solidFill'], theme);
    return lnColor ?? fillColor;
}
function parseAxis(ax, theme) {
    if (!ax || typeof ax !== 'object')
        return undefined;
    const out = {};
    const scaling = ax['c:scaling'];
    if (scaling?.['c:min']?.['@_val'] != null)
        out.min = Number(scaling['c:min']['@_val']);
    if (scaling?.['c:max']?.['@_val'] != null)
        out.max = Number(scaling['c:max']['@_val']);
    if (scaling?.['c:orientation']?.['@_val'] === 'maxMin')
        out.reversed = true;
    const defRPr = ax['c:txPr']?.['a:p']?.[0]?.['a:pPr']?.['a:defRPr'] ?? ax['c:txPr']?.['a:p']?.['a:pPr']?.['a:defRPr'];
    if (defRPr) {
        const c = (0, color_1.resolveColorNode)(defRPr['a:solidFill'], theme);
        if (c)
            out.labelColor = c;
        if (defRPr['@_sz'])
            out.labelSizePt = parseInt(defRPr['@_sz'], 10) / 100;
    }
    const lineColor = (0, color_1.resolveColorNode)(ax['c:spPr']?.['a:ln']?.['a:solidFill'], theme);
    if (lineColor)
        out.lineColor = lineColor;
    // A self-closing <c:majorGridlines/> (no spPr) parses to an empty string; still counts as having gridlines
    const grid = ax['c:majorGridlines'];
    if (grid !== undefined) {
        const spPr = typeof grid === 'object' ? grid['c:spPr'] : undefined;
        const gc = (0, color_1.resolveColorNode)(spPr?.['a:ln']?.['a:solidFill'], theme);
        out.gridColor = gc ?? '#E6E6E6';
        if (spPr?.['a:ln']?.['a:prstDash']?.['@_val'] === 'dash')
            out.gridDash = true;
    }
    // Axis title (all a:t inside c:title/c:tx/c:rich concatenated)
    const title = collectText(ax['c:title']?.['c:tx']?.['c:rich']);
    if (title)
        out.title = title;
    return Object.keys(out).length ? out : undefined;
}
/** Collect all a:t inside a rich text node. */
function collectText(rich) {
    if (!rich)
        return undefined;
    const paras = Array.isArray(rich['a:p']) ? rich['a:p'] : rich['a:p'] ? [rich['a:p']] : [];
    const parts = [];
    for (const p of paras) {
        const runs = Array.isArray(p['a:r']) ? p['a:r'] : p['a:r'] ? [p['a:r']] : [];
        for (const r of runs) {
            const t = r['a:t'];
            parts.push(typeof t === 'string' ? t : String(t?.['#text'] ?? ''));
        }
    }
    const s = parts.join('');
    return s.trim() ? s : undefined;
}
