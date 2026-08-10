"use strict";
/**
 * pptx-engine data model
 *
 * Design principles:
 * 1. The in-house model is the core asset (Canva-style): rendering / editing /
 *    saving all revolve around it.
 * 2. Byte-level fidelity: every parseable element carries a dual anchor —
 *    `slideXmlRange` (original XML byte range) + `originalXml` (original slice).
 *    On save, untouched elements pass through as their original bytes.
 * 3. Inheritance chain pre-resolved: elements carry `resolved` final styles
 *    (merged slide→layout→master→theme); the render layer uses them directly and
 *    never walks inheritance. The original pptx's layout/master/theme are never
 *    written back.
 * 4. Risky content is passthrough: only a placeholder is shown, original bytes
 *    pass through on save.
 *
 * Coordinate unit: EMU (English Metric Unit, 1 inch = 914400 EMU, 1 px@96dpi = 9525 EMU).
 * Angle unit: 60000ths of a degree (OOXML native), with a convenience `deg` field.
 */
Object.defineProperty(exports, "__esModule", { value: true });
