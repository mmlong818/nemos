"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAGE_MARK = exports.TOTAL_PAGES_MARK = void 0;
/** Placeholder for NUMPAGES (total pages) fields in headers/footers; the renderer substitutes the total page count and saving writes the field back (PAGE uses PAGE_MARK the same way) */
exports.TOTAL_PAGES_MARK = '\uE000';
/** Placeholder for PAGE fields in headers/footers; a private-use character so literal '#' text in the part can never be mistaken for the field position */
exports.PAGE_MARK = '\uE001';
