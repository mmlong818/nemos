"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveColorNode = resolveColorNode;
exports.applyColorMods = applyColorMods;
exports.hexToRgb = hexToRgb;
/**
 * Color node resolution (srgbClr/schemeClr/sysClr + lumMod/lumOff/tint/shade/alpha modifiers).
 * Extracted from parse.ts into a shared module: used by both parse (run/fill colors) and
 * placeholder (lstStyle defRPr default colors) to avoid a circular dependency.
 */
const theme_1 = require("./theme");
const xml_utils_1 = require("./xml-utils");
/**
 * Resolve a color node + modifiers: srgbClr/schemeClr/sysClr, supporting alpha
 * (→#RRGGBBAA) and lumMod/lumOff (tint/shade, common for theme colors).
 */
function resolveColorNode(node, theme, phClr) {
    if (!node)
        return undefined;
    const n = (0, xml_utils_1.asXmlNode)(node);
    let base;
    let mods;
    if (n['a:srgbClr']) {
        mods = (0, xml_utils_1.asXmlNode)(n['a:srgbClr']);
        base = '#' + String(mods['@_val']).toUpperCase();
    }
    else if (n['a:schemeClr']) {
        mods = (0, xml_utils_1.asXmlNode)(n['a:schemeClr']);
        base = (0, theme_1.resolveSchemeColor)(String(mods['@_val']), theme, phClr);
    }
    else if (n['a:sysClr']) {
        mods = (0, xml_utils_1.asXmlNode)(n['a:sysClr']);
        base = '#' + String(mods['@_lastClr'] ?? '000000').toUpperCase();
    }
    if (!base)
        return undefined;
    return applyColorMods(base, mods);
}
/** Apply lumMod/lumOff/tint/shade/satMod/alpha modifiers (percentages, in units of 1/1000%). */
function applyColorMods(hex, mods) {
    let { r, g, b } = hexToRgb(hex);
    const pct = (k) => {
        const v = (0, xml_utils_1.asXmlNode)(mods?.[k])['@_val'];
        return v != null ? (parseInt(String(v), 10) || 0) / 100000 : undefined;
    };
    const lumMod = pct('a:lumMod');
    const lumOff = pct('a:lumOff');
    const shade = pct('a:shade');
    const tint = pct('a:tint');
    // satMod (frequent in theme gradient templates): HSL saturation multiplier
    const satMod = pct('a:satMod');
    if (satMod != null) {
        const { h, s, l } = rgbToHsl(r, g, b);
        const rgb2 = hslToRgb(h, Math.max(0, Math.min(1, s * satMod)), l);
        r = rgb2.r;
        g = rgb2.g;
        b = rgb2.b;
    }
    if (lumMod != null) {
        r *= lumMod;
        g *= lumMod;
        b *= lumMod;
    }
    if (lumOff != null) {
        r += 255 * lumOff;
        g += 255 * lumOff;
        b += 255 * lumOff;
    }
    if (shade != null) {
        r *= shade;
        g *= shade;
        b *= shade;
    }
    if (tint != null) {
        r = r * tint + 255 * (1 - tint);
        g = g * tint + 255 * (1 - tint);
        b = b * tint + 255 * (1 - tint);
    }
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    let out = '#' + [clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    const alpha = pct('a:alpha');
    if (alpha != null && alpha < 1) {
        out += Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase();
    }
    return out;
}
function hexToRgb(hex) {
    const h = hex.replace(/^#/, '');
    return {
        r: parseInt(h.slice(0, 2), 16) || 0,
        g: parseInt(h.slice(2, 4), 16) || 0,
        b: parseInt(h.slice(4, 6), 16) || 0,
    };
}
function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min)
        return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r)
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g)
        h = ((b - r) / d + 2) / 6;
    else
        h = ((r - g) / d + 4) / 6;
    return { h, s, l };
}
function hslToRgb(h, s, l) {
    if (s === 0) {
        const v = l * 255;
        return { r: v, g: v, b: v };
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
        if (t < 0)
            t += 1;
        if (t > 1)
            t -= 1;
        if (t < 1 / 6)
            return p + (q - p) * 6 * t;
        if (t < 1 / 2)
            return q;
        if (t < 2 / 3)
            return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return { r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255 };
}
