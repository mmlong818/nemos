"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyHeaderFooter = applyHeaderFooter;
exports.readHeaderFooter = readHeaderFooter;
const generate_1 = require("./generate");
const index_1 = require("./index");
const insert_1 = require("./insert");
const HF_TYPES = new Set(['ftr', 'sldNum', 'dt']);
function hfSpXml(slide, type, idx, box, para) {
    const id = (0, insert_1.nextCNvPrId)(slide);
    const nameMap = {
        dt: 'Date Placeholder',
        ftr: 'Footer Placeholder',
        sldNum: 'Slide Number Placeholder',
    };
    return (`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${nameMap[type]} ${id}"/>` +
        '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
        `<p:nvPr><p:ph type="${type}" sz="${type === 'dt' ? 'half' : 'quarter'}" idx="${idx}"/></p:nvPr></p:nvSpPr>` +
        `<p:spPr><a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.cx}" cy="${box.cy}"/></a:xfrm>` +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
        '<p:txBody><a:bodyPr vert="horz" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr"/><a:lstStyle/>' +
        (0, generate_1.generateParagraphXml)(para) +
        '</p:txBody></p:sp>');
}
/**
 * Apply header/footer to the given slides (all slides by default).
 * Removes existing dt/ftr/sldNum placeholder elements first, then appends new
 * ones per the toggles. Returns whether any slide was modified.
 */
function applyHeaderFooter(opened, opts, slideIndexes) {
    const { deck } = opened;
    const targets = slideIndexes ?? deck.slides.map((_, i) => i);
    const { cx, cy } = deck.size;
    const barH = Math.round(cy * 0.045);
    const barY = Math.round(cy * 0.93);
    const style = { fontSize: 12, color: '898989' };
    let changed = false;
    for (const i of targets) {
        const slide = deck.slides[i];
        if (!slide)
            continue;
        // 1) Remove existing footer-family placeholders
        const before = slide.elements.length;
        slide.elements = slide.elements.filter((el) => !(el.placeholder && HF_TYPES.has(el.placeholder)));
        let dirty = slide.elements.length !== before;
        // 2) Append enabled placeholders (order: dt left → ftr center → sldNum right)
        const pushSp = (xml) => {
            const el = {
                // materialize reparses the whole slide, so these temporary model fields suffice
                id: `hfnew_${slide.elements.length}_${Date.now().toString(36)}`,
                type: 'text',
                anchor: { spIndex: slide.elements.length, originalXml: xml, range: [0, 0] },
                transform: { offset: { x: 0, y: 0, cx: 0, cy: 0 }, rot: 0, flipH: false, flipV: false },
            };
            slide.elements.push(el);
            dirty = true;
        };
        if (opts.date) {
            pushSp(hfSpXml(slide, 'dt', 10, { x: Math.round(cx * 0.05), y: barY, cx: Math.round(cx * 0.22), cy: barH }, {
                align: 'left',
                runs: [
                    opts.dateAuto
                        ? { text: opts.date, field: 'datetime1', ...style }
                        : { text: opts.date, ...style },
                ],
            }));
        }
        if (opts.footer) {
            pushSp(hfSpXml(slide, 'ftr', 11, { x: Math.round(cx * 0.3), y: barY, cx: Math.round(cx * 0.4), cy: barH }, {
                align: 'center',
                runs: [{ text: opts.footer, ...style }],
            }));
        }
        if (opts.slideNum) {
            pushSp(hfSpXml(slide, 'sldNum', 12, { x: Math.round(cx * 0.86), y: barY, cx: Math.round(cx * 0.09), cy: barH }, {
                align: 'right',
                runs: [{ text: String(i + 1), field: 'slidenum', ...style }],
            }));
        }
        if (dirty) {
            slide.structureDirty = true;
            (0, index_1.materializeSlide)(opened, i);
            changed = true;
        }
    }
    return changed;
}
/** Read a slide's current footer state (for dialog echo-back). */
function readHeaderFooter(slide) {
    let footer = null;
    let date = null;
    let slideNum = false;
    for (const el of slide.elements) {
        if (el.type !== 'text' && el.type !== 'shape')
            continue;
        const text = el.text?.paragraphs
            .map((p) => p.runs.map((r) => r.text).join(''))
            .join('\n')
            .trim();
        if (el.placeholder === 'ftr')
            footer = text || null;
        else if (el.placeholder === 'dt')
            date = text || null;
        else if (el.placeholder === 'sldNum')
            slideNum = true;
    }
    return { footer, slideNum, date };
}
