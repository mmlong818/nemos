"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHART_WORKBOOK_REL_TYPE = void 0;
exports.parseChartPartXml = parseChartPartXml;
exports.buildChartPartXml = buildChartPartXml;
exports.patchChartPartXml = patchChartPartXml;
exports.buildChartWorkbookXlsxBase64 = buildChartWorkbookXlsxBase64;
exports.patchChartWorkbookXlsxBase64 = patchChartWorkbookXlsxBase64;
const jszip_1 = __importDefault(require("jszip"));
const xml_utils_1 = require("./xml-utils");
const CHART_KINDS = {
    'c:barChart': 'bar',
    'c:bar3DChart': 'bar',
    'c:lineChart': 'line',
    'c:line3DChart': 'line',
    'c:pieChart': 'pie',
    'c:pie3DChart': 'pie',
    'c:doughnutChart': 'pie',
    'c:areaChart': 'area',
    'c:area3DChart': 'area',
};
/**
 * Read the display model of a chart part (word/charts/chartN.xml). Only the
 * caches Word writes next to the data references (c:strCache / c:numCache)
 * are read — the embedded workbook is never opened. Returns null when the
 * part has no series with cached values (e.g. scatter charts).
 */
function parseChartPartXml(xml, partPath) {
    const parsed = xml_utils_1.xmlParser.parse(xml);
    const space = parsed.find((n) => (0, xml_utils_1.nameOf)(n) === 'c:chartSpace');
    const chart = space ? (0, xml_utils_1.findChild)(space, 'c:chart') : undefined;
    const plotArea = chart ? (0, xml_utils_1.findChild)(chart, 'c:plotArea') : undefined;
    if (!chart || !plotArea)
        return null;
    // first plotted chart type wins (combo charts render their primary series)
    const plot = (0, xml_utils_1.childrenOf)(plotArea).find((c) => ((0, xml_utils_1.nameOf)(c) ?? '').endsWith('Chart'));
    if (!plot)
        return null;
    const kind = CHART_KINDS[(0, xml_utils_1.nameOf)(plot) ?? ''] ?? 'other';
    let categories = [];
    const series = [];
    for (const ser of (0, xml_utils_1.findChildren)(plot, 'c:ser')) {
        const val = (0, xml_utils_1.findChild)(ser, 'c:val');
        const rawValues = val ? cachePoints(val) : [];
        const values = rawValues.map((v) => {
            if (v === null || v.trim() === '')
                return null;
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        });
        if (values.length === 0)
            continue;
        const cat = (0, xml_utils_1.findChild)(ser, 'c:cat');
        if (cat && categories.length === 0) {
            categories = cachePoints(cat).map((v) => v ?? '');
        }
        const name = seriesName(ser);
        series.push({ ...(name !== undefined ? { name } : {}), values });
    }
    if (series.length === 0)
        return null;
    const title = chartTitle(chart);
    return {
        partPath,
        kind,
        ...(title !== undefined ? { title } : {}),
        categories,
        series,
    };
}
/** cached point texts of a c:cat / c:val / c:tx container, in idx order */
function cachePoints(container) {
    const ref = (0, xml_utils_1.findChild)(container, 'c:strRef') ?? (0, xml_utils_1.findChild)(container, 'c:numRef');
    const cache = ref
        ? ((0, xml_utils_1.findChild)(ref, 'c:strCache') ?? (0, xml_utils_1.findChild)(ref, 'c:numCache'))
        : ((0, xml_utils_1.findChild)(container, 'c:strLit') ?? (0, xml_utils_1.findChild)(container, 'c:numLit'));
    if (!cache)
        return [];
    const count = parseInt((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(cache, 'c:ptCount') ?? {})['val'] ?? '', 10);
    const points = [];
    for (const pt of (0, xml_utils_1.findChildren)(cache, 'c:pt')) {
        const idx = parseInt((0, xml_utils_1.attrsOf)(pt)['idx'] ?? '', 10);
        if (!Number.isFinite(idx) || idx < 0)
            continue;
        points[idx] = (0, xml_utils_1.textOf)((0, xml_utils_1.findChild)(pt, 'c:v') ?? {});
    }
    const length = Number.isFinite(count) ? Math.max(count, points.length) : points.length;
    const out = [];
    for (let i = 0; i < length; i++)
        out.push(points[i] ?? null);
    return out;
}
function seriesName(ser) {
    const tx = (0, xml_utils_1.findChild)(ser, 'c:tx');
    if (!tx)
        return undefined;
    const literal = (0, xml_utils_1.findChild)(tx, 'c:v');
    if (literal)
        return (0, xml_utils_1.textOf)(literal);
    const cached = cachePoints(tx);
    return cached[0] ?? undefined;
}
function chartTitle(chart) {
    const title = (0, xml_utils_1.findChild)(chart, 'c:title');
    if (!title)
        return undefined;
    const texts = [];
    const walk = (node) => {
        for (const child of (0, xml_utils_1.childrenOf)(node)) {
            if ((0, xml_utils_1.nameOf)(child) === 'a:t')
                texts.push((0, xml_utils_1.textOf)(child));
            else
                walk(child);
        }
    };
    walk(title);
    return texts.join('');
}
const _XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
exports.CHART_WORKBOOK_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package';
const colLetter = (i) => String.fromCharCode(66 + i); // B, C, D...
function strCacheXml(values, f) {
    return (`<c:strRef><c:f>${(0, xml_utils_1.escapeXmlText)(f)}</c:f><c:strCache><c:ptCount val="${values.length}"/>` +
        values.map((v, i) => `<c:pt idx="${i}"><c:v>${(0, xml_utils_1.escapeXmlText)(v)}</c:v></c:pt>`).join('') +
        '</c:strCache></c:strRef>');
}
function numCacheXml(values, f) {
    return (`<c:numRef><c:f>${(0, xml_utils_1.escapeXmlText)(f)}</c:f><c:numCache><c:formatCode>General</c:formatCode>` +
        `<c:ptCount val="${values.length}"/>` +
        values.map((v, i) => (v === null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('') +
        '</c:numCache></c:numRef>');
}
/**
 * Build a complete chart part (word/charts/chartN.xml) from data. The chart
 * references an embedded workbook via c:externalData so Word's "Edit Data" works.
 * Pass `externalDataRId` to wire the c:externalData relationship; omit it when
 * the workbook will be added in a separate step.
 */
function buildChartPartXml(chart, externalDataRId) {
    const rows = chart.categories.length;
    const sers = chart.series
        .map((ser, i) => {
        const col = colLetter(i);
        return (`<c:ser><c:idx val="${i}"/><c:order val="${i}"/>` +
            `<c:tx>${strCacheXml([ser.name], `Sheet1!$${col}$1`)}</c:tx>` +
            `<c:cat>${strCacheXml(chart.categories, `Sheet1!$A$2:$A$${rows + 1}`)}</c:cat>` +
            `<c:val>${numCacheXml(ser.values.slice(0, rows), `Sheet1!$${col}$2:$${col}$${rows + 1}`)}</c:val>` +
            '</c:ser>');
    })
        .join('');
    let plot;
    if (chart.kind === 'pie') {
        plot = `<c:pieChart><c:varyColors val="1"/>${sers}<c:firstSliceAng val="0"/></c:pieChart>`;
    }
    else {
        const axes = '<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling>' +
            '<c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222222222"/></c:catAx>' +
            '<c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling>' +
            '<c:delete val="0"/><c:axPos val="l"/><c:crossAx val="111111111"/></c:valAx>';
        const inner = chart.kind === 'bar'
            ? `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${sers}` +
                '<c:axId val="111111111"/><c:axId val="222222222"/></c:barChart>'
            : `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers}<c:marker val="1"/>` +
                '<c:axId val="111111111"/><c:axId val="222222222"/></c:lineChart>';
        plot = inner + axes;
    }
    const title = chart.title
        ? '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r>' +
            `<a:t>${(0, xml_utils_1.escapeXmlText)(chart.title)}</a:t></a:r></a:p></c:rich></c:tx>` +
            '<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>'
        : '';
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ' +
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<c:chart>${title}<c:plotArea><c:layout/>${plot}</c:plotArea>` +
        '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>' +
        (externalDataRId
            ? `<c:externalData r:id="${externalDataRId}"><c:autoUpdate val="0"/></c:externalData>`
            : '') +
        '</c:chartSpace>');
}
/**
 * Patch cached texts/numbers of a chart part while keeping the structure —
 * data references (c:f), styling, layout — byte-identical. Anything the
 * patch cannot anchor (missing title, missing cache point) is left as-is.
 * The embedded workbook is intentionally not touched: Word renders from
 * these caches, but "Edit Data" will show the original sheet numbers.
 */
function patchChartPartXml(xml, patch) {
    const edits = [];
    if (patch.title !== undefined) {
        const title = tagRange(xml, 'c:title');
        if (title) {
            const texts = innerTextRanges(xml, 'a:t', title.start, title.end);
            // whole title into the first run, remaining runs blanked
            texts.forEach((range, i) => {
                edits.push({ ...range, text: i === 0 ? patch.title : '' });
            });
        }
    }
    const serRanges = tagRanges(xml, 'c:ser');
    serRanges.forEach((ser, i) => {
        const serPatch = patch.series?.[i];
        if (serPatch?.name !== undefined) {
            const tx = tagRange(xml, 'c:tx', ser.start, ser.end);
            if (tx) {
                const texts = innerTextRanges(xml, 'c:v', tx.start, tx.end);
                if (texts.length > 0)
                    edits.push({ ...texts[0], text: serPatch.name });
            }
        }
        if (serPatch?.values) {
            const val = tagRange(xml, 'c:val', ser.start, ser.end);
            if (val)
                pushPointEdits(xml, val, serPatch.values.map((v) => (v === null ? null : String(v))), edits);
        }
        // categories are cached per series; every copy must agree
        if (patch.categories) {
            const cat = tagRange(xml, 'c:cat', ser.start, ser.end);
            if (cat)
                pushPointEdits(xml, cat, patch.categories, edits);
        }
    });
    if (edits.length === 0)
        return xml;
    let out = xml;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
        out = out.slice(0, edit.start) + (0, xml_utils_1.escapeXmlText)(edit.text) + out.slice(edit.end);
    }
    return out;
}
/** queue edits for the c:v of each indexed cache point present in [range] */
function pushPointEdits(xml, range, texts, edits) {
    const re = /<c:pt idx="(\d+)"[^>]*>([\s\S]*?)<\/c:pt>/g;
    re.lastIndex = range.start;
    let m;
    while ((m = re.exec(xml)) !== null && m.index < range.end) {
        const idx = parseInt(m[1], 10);
        const text = texts[idx];
        if (text === null || text === undefined)
            continue;
        const inner = innerTextRanges(xml, 'c:v', m.index, m.index + m[0].length);
        if (inner.length > 0)
            edits.push({ ...inner[0], text });
    }
}
/** first depth-0 range of `tag` in [from, to); charts never nest these tags */
function tagRange(xml, tag, from = 0, to = xml.length) {
    const openPrefix = '<' + tag;
    let i = from;
    while (i < to) {
        const o = xml.indexOf(openPrefix, i);
        if (o === -1 || o >= to)
            return null;
        const after = xml.charAt(o + openPrefix.length);
        if (after !== '>' && after !== ' ' && after !== '/') {
            i = o + openPrefix.length; // prefix of a longer tag (c:tx vs c:txPr)
            continue;
        }
        const close = xml.indexOf('</' + tag + '>', o);
        if (close === -1 || close >= to)
            return null;
        return { start: o, end: close + tag.length + 3 };
    }
    return null;
}
/** all depth-0 ranges of `tag` (used for c:ser, which never nests) */
function tagRanges(xml, tag) {
    const out = [];
    let from = 0;
    let range;
    while ((range = tagRange(xml, tag, from)) !== null) {
        out.push(range);
        from = range.end;
    }
    return out;
}
/** inner-text ranges (between open and close tag) of every `tag` in [from, to) */
function innerTextRanges(xml, tag, from, to) {
    const out = [];
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
    re.lastIndex = from;
    let m;
    while ((m = re.exec(xml)) !== null && m.index < to) {
        const openEnd = m.index + m[0].indexOf('>') + 1;
        out.push({ start: openEnd, end: openEnd + m[1].length });
    }
    return out;
}
// ---- embedded xlsx workbook ----
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
/** Excel column letter: A, B, C... */
const xlsxColLetter = (i) => String.fromCharCode(65 + i);
/**
 * Build a minimal but valid xlsx file containing one Sheet1 with the chart
 * data (header row + data rows). Returns base64-encoded bytes.
 *
 * Layout:
 *   A1        | B1 (ser 0 name) | C1 (ser 1 name) ...
 *   A2 (cat0) | B2 (val 0,0)    | C2 (val 1,0)   ...
 *   A3 (cat1) | B3 (val 0,1)    | C3 (val 1,1)   ...
 */
async function buildChartWorkbookXlsxBase64(categories, series) {
    const rows = categories.length;
    const serCount = series.length;
    // shared strings: all text cells collected in order
    const strings = [];
    const si = (s) => {
        const idx = strings.indexOf(s);
        if (idx !== -1)
            return idx;
        strings.push(s);
        return strings.length - 1;
    };
    // Build sheetData rows
    const headerCells = [];
    // A1: empty label cell
    headerCells.push(`<c r="A1" t="s"><v>${si('')}</v></c>`);
    for (let j = 0; j < serCount; j++) {
        headerCells.push(`<c r="${xlsxColLetter(j + 1)}1" t="s"><v>${si(series[j].name)}</v></c>`);
    }
    const dataRows = [];
    for (let i = 0; i < rows; i++) {
        const rowNum = i + 2;
        const cells = [];
        cells.push(`<c r="A${rowNum}" t="s"><v>${si(categories[i])}</v></c>`);
        for (let j = 0; j < serCount; j++) {
            const val = series[j].values[i];
            if (val !== null && val !== undefined) {
                cells.push(`<c r="${xlsxColLetter(j + 1)}${rowNum}"><v>${val}</v></c>`);
            }
        }
        dataRows.push(`<row r="${rowNum}">${cells.join('')}</row>`);
    }
    const sheetXml = XML_DECL +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetData>' +
        `<row r="1">${headerCells.join('')}</row>` +
        dataRows.join('') +
        '</sheetData>' +
        '</worksheet>';
    const sharedStringsXml = XML_DECL +
        `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
        strings.map((s) => `<si><t>${(0, xml_utils_1.escapeXmlText)(s)}</t></si>`).join('') +
        '</sst>';
    const workbookXml = XML_DECL +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>' +
        '</workbook>';
    const workbookRels = XML_DECL +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
        '</Relationships>';
    const topRels = XML_DECL +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>';
    const contentTypes = XML_DECL +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
        '</Types>';
    const zip = new jszip_1.default();
    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', topRels);
    zip.file('xl/workbook.xml', workbookXml);
    zip.file('xl/_rels/workbook.xml.rels', workbookRels);
    zip.file('xl/worksheets/sheet1.xml', sheetXml);
    zip.file('xl/sharedStrings.xml', sharedStringsXml);
    return zipToBase64(zip);
}
async function zipToBase64(zip) {
    const bytes = await zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
    });
    let binary = '';
    for (let i = 0; i < bytes.length; i++)
        binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}
/**
 * Patch the Sheet1 sheetData inside an embedded xlsx file (base64).
 * Rewrites category column A and each series column with the provided values.
 * Returns the updated base64, or null on failure.
 */
async function patchChartWorkbookXlsxBase64(base64, categories, series) {
    try {
        const binaryStr = atob(base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++)
            bytes[i] = binaryStr.charCodeAt(i);
        const zip = await jszip_1.default.loadAsync(bytes);
        const sheetFile = zip.file('xl/worksheets/sheet1.xml');
        if (!sheetFile)
            return null;
        // Replace only Sheet1's sheetData in place, using inline strings so
        // sharedStrings.xml (and every other part: styles, extra sheets, defined
        // names) survives untouched.
        const inlineStr = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${(0, xml_utils_1.escapeXmlText)(text)}</t></is></c>`;
        const headerCells = [inlineStr('A1', '')];
        for (let j = 0; j < series.length; j++) {
            headerCells.push(inlineStr(`${xlsxColLetter(j + 1)}1`, series[j].name));
        }
        const dataRows = [];
        for (let i = 0; i < categories.length; i++) {
            const rowNum = i + 2;
            const cells = [inlineStr(`A${rowNum}`, categories[i])];
            for (let j = 0; j < series.length; j++) {
                const val = series[j].values[i];
                if (val !== null && val !== undefined) {
                    cells.push(`<c r="${xlsxColLetter(j + 1)}${rowNum}"><v>${val}</v></c>`);
                }
            }
            dataRows.push(`<row r="${rowNum}">${cells.join('')}</row>`);
        }
        const newSheetData = `<sheetData><row r="1">${headerCells.join('')}</row>${dataRows.join('')}</sheetData>`;
        const sheetXml = await sheetFile.async('string');
        if (!/<sheetData\/>|<sheetData[\s>]/.test(sheetXml))
            return null;
        let updatedSheet = sheetXml.replace(/<sheetData\/>|<sheetData[^>]*>[\s\S]*?<\/sheetData>/, newSheetData);
        const lastRef = `${xlsxColLetter(series.length)}${categories.length + 1}`;
        updatedSheet = updatedSheet.replace(/<dimension[^>]*\/>/, `<dimension ref="A1:${lastRef}"/>`);
        zip.file('xl/worksheets/sheet1.xml', updatedSheet);
        return await zipToBase64(zip);
    }
    catch {
        return null;
    }
}
