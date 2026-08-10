"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recolorXml = exports.patchThemeXml = exports.collectExplicitColors = exports.buildColorMap = exports.applyThemeToArchive = exports.isBackgroundLikeElement = exports.promoteSlideBackground = exports.createBlankPptx = exports.distributeRects = exports.alignRects = exports.calcBoundingBox = exports.buildGrpSpXml = exports.buildTableXml = exports.buildSpXml = exports.deleteElement = exports.addPicture = exports.addElement = exports.generateXfrmXml = exports.generateParagraphXml = exports.readSlideTransitionXml = exports.readSlideHiddenXml = exports.readSlideAdvanceTimeXml = exports.patchSlideTransitionXml = exports.patchSlideHiddenXml = exports.patchSlideBackgroundXml = exports.patchSlideAdvanceTimeXml = exports.patchPictureSrcRect = exports.patchBodyPrAutofit = exports.patchElementStroke = exports.patchParagraphPPrXml = exports.patchElementPPr = exports.patchElementFill = exports.patchElementXfrm = exports.patchTextElementXml = exports.parseTheme = exports.tableRowGridCols = exports.EMU_PER_PT = exports.parseDecorations = exports.parseSlide = exports.scanSlide = exports.PackageArchive = exports.setSlideAnimations = exports.readSlideTimingXml = exports.patchSlideTimingXml = exports.patchSlideTimingIncrementalXml = exports.getSlideAnimations = exports.elementSpid = exports.DEFAULT_MOTION_PATH = exports.buildTimingXml = exports.animClassOf = void 0;
exports.removeSection = exports.renameSection = exports.addSection = exports.setSections = exports.getSections = exports.readHeaderFooter = exports.applyHeaderFooter = exports.solidPng = exports.model3dPartOf = exports.addModel3d = exports.addMedia = exports.buildSmartArtXml = exports.addSmartArt = exports.buildChartSpaceXml = exports.addChart = exports.decodeRunLink = exports.encodeRunLink = exports.ensureRunLinkRels = exports.getRunLinks = exports.getSlideLinks = exports.getElementLink = exports.setElementLink = exports.deleteSlideComment = exports.addSlideComment = exports.getSlideComments = exports.unescapeXml = exports.notesPathForSlide = exports.setSlideNotes = exports.getSlideNotes = exports.parseChartXml = exports.applyColorMods = exports.resolveColorNode = exports.resolveFontRef = exports.mergeTextStyleChain = exports.placeholderStyleChain = exports.parseLstStyleLevels = exports.parseMasterTextStyles = exports.resolvePlaceholderTransform = exports.parsePlaceholderMap = exports.shouldOfferBuiltinLayouts = exports.ensureBuiltinLayout = exports.builtinLayoutInfos = exports.BUILTIN_LAYOUT_PREFIX = exports.BUILTIN_LAYOUTS = exports.listSlideLayouts = exports.applyFormat = exports.extractFormat = exports.escapeXmlAttr = exports.escapeXmlText = exports.remapDeckColors = void 0;
exports.parseMasterPart = exports.listMasterParts = exports.TABLE_STYLE_PRESETS = exports.ensureTableStyleXml = exports.findTableElementInSlide = exports.patchTableStyleXml = exports.listLayouts = exports.chooseLayout = exports.materializeSlideBundle = exports.importSourceLayout = exports.collectSlideBundle = exports.normalizeSections = exports.moveSlide = exports.moveSection = void 0;
exports.openPptx = openPptx;
exports.reparseDeck = reparseDeck;
exports.savePptx = savePptx;
exports.savePptxToFile = savePptxToFile;
exports.commitSaved = commitSaved;
exports.patchSlideXml = patchSlideXml;
exports.patchedElementXml = patchedElementXml;
exports.setSlideBackground = setSlideBackground;
exports.editPictureSrcRect = editPictureSrcRect;
exports.setElementTextAnchor = setElementTextAnchor;
exports.setElementImageFill = setElementImageFill;
exports.setPictureOpacity = setPictureOpacity;
exports.replacePictureBytes = replacePictureBytes;
exports.duplicateSlide = duplicateSlide;
exports.copySlide = copySlide;
exports.pasteSlide = pasteSlide;
exports.insertBlankSlide = insertBlankSlide;
exports.mergeSlideFromPptx = mergeSlideFromPptx;
exports.insertSlideWithLayout = insertSlideWithLayout;
exports.deleteSlide = deleteSlide;
exports.reorderElement = reorderElement;
exports.materializeSlide = materializeSlide;
exports.updateConnectorsForMoved = updateConnectorsForMoved;
exports.setElementConnection = setElementConnection;
exports.setSlideLayout = setSlideLayout;
exports.resetSlideLayout = resetSlideLayout;
exports.setSlideSize = setSlideSize;
exports.appendRawElements = appendRawElements;
exports.addTable = addTable;
exports.editTableCellText = editTableCellText;
exports.editTableStyle = editTableStyle;
exports.ensureTableStylePart = ensureTableStylePart;
exports.editChartElement = editChartElement;
exports.markChartEditable = markChartEditable;
exports.getChartElementData = getChartElementData;
exports.setElementFont = setElementFont;
exports.replaceAllInDeck = replaceAllInDeck;
exports.setElementParagraphFormat = setElementParagraphFormat;
exports.setGroupChildParagraphFormat = setGroupChildParagraphFormat;
exports.editTableStructure = editTableStructure;
exports.mergeTableCells = mergeTableCells;
exports.setTableColWidth = setTableColWidth;
exports.setTableRowHeight = setTableRowHeight;
exports.resizeTable = resizeTable;
exports.setTableCellAnchor = setTableCellAnchor;
exports.copyElementData = copyElementData;
exports.pasteElements = pasteElements;
exports.setSlideTransition = setSlideTransition;
exports.getSlideTransition = getSlideTransition;
exports.setSlideAdvanceTime = setSlideAdvanceTime;
exports.getSlideAdvanceTime = getSlideAdvanceTime;
exports.setSlideHidden = setSlideHidden;
exports.getSlideHidden = getSlideHidden;
exports.reassembleSlideXml = reassembleSlideXml;
exports.groupElements = groupElements;
exports.ungroupElement = ungroupElement;
exports.groupChildSlices = groupChildSlices;
exports.patchGroupChildXml = patchGroupChildXml;
exports.findGroupChild = findGroupChild;
exports.editGroupChildTransform = editGroupChildTransform;
exports.patchGroupChildText = patchGroupChildText;
exports.setGroupChildFont = setGroupChildFont;
exports.editGroupChildFill = editGroupChildFill;
exports.editGroupChildStroke = editGroupChildStroke;
/**
 * pptx-engine top-level API.
 *
 * Phase 1 scope: openPptx (parsing) + savePptx's "no changes = byte identical"
 * path (proving fidelity). Element-level patch regeneration is left for Phase 3.
 */
const jszip_1 = __importDefault(require("jszip"));
const zip_1 = require("./zip");
const theme_1 = require("./theme");
const parse_1 = require("./parse");
const placeholder_1 = require("./placeholder");
const generate_1 = require("./generate");
const insert_1 = require("./insert");
const blank_1 = require("./blank");
const xml_utils_1 = require("./xml-utils");
const animation_1 = require("./animation");
const master_edit_1 = require("./master-edit");
const table_edit_1 = require("./table-edit");
const chart_insert_1 = require("./chart-insert");
const layout_1 = require("./layout");
const slide_transfer_1 = require("./slide-transfer");
const sections_1 = require("./sections");
__exportStar(require("./types"), exports);
var animation_2 = require("./animation");
Object.defineProperty(exports, "animClassOf", { enumerable: true, get: function () { return animation_2.animClassOf; } });
Object.defineProperty(exports, "buildTimingXml", { enumerable: true, get: function () { return animation_2.buildTimingXml; } });
Object.defineProperty(exports, "DEFAULT_MOTION_PATH", { enumerable: true, get: function () { return animation_2.DEFAULT_MOTION_PATH; } });
Object.defineProperty(exports, "elementSpid", { enumerable: true, get: function () { return animation_2.elementSpid; } });
Object.defineProperty(exports, "getSlideAnimations", { enumerable: true, get: function () { return animation_2.getSlideAnimations; } });
Object.defineProperty(exports, "patchSlideTimingIncrementalXml", { enumerable: true, get: function () { return animation_2.patchSlideTimingIncrementalXml; } });
Object.defineProperty(exports, "patchSlideTimingXml", { enumerable: true, get: function () { return animation_2.patchSlideTimingXml; } });
Object.defineProperty(exports, "readSlideTimingXml", { enumerable: true, get: function () { return animation_2.readSlideTimingXml; } });
Object.defineProperty(exports, "setSlideAnimations", { enumerable: true, get: function () { return animation_2.setSlideAnimations; } });
var zip_2 = require("./zip");
Object.defineProperty(exports, "PackageArchive", { enumerable: true, get: function () { return zip_2.PackageArchive; } });
var scan_1 = require("./scan");
Object.defineProperty(exports, "scanSlide", { enumerable: true, get: function () { return scan_1.scanSlide; } });
var parse_2 = require("./parse");
Object.defineProperty(exports, "parseSlide", { enumerable: true, get: function () { return parse_2.parseSlide; } });
Object.defineProperty(exports, "parseDecorations", { enumerable: true, get: function () { return parse_2.parseDecorations; } });
Object.defineProperty(exports, "EMU_PER_PT", { enumerable: true, get: function () { return parse_2.EMU_PER_PT; } });
var table_grid_1 = require("./table-grid");
Object.defineProperty(exports, "tableRowGridCols", { enumerable: true, get: function () { return table_grid_1.tableRowGridCols; } });
var theme_2 = require("./theme");
Object.defineProperty(exports, "parseTheme", { enumerable: true, get: function () { return theme_2.parseTheme; } });
var generate_2 = require("./generate");
Object.defineProperty(exports, "patchTextElementXml", { enumerable: true, get: function () { return generate_2.patchTextElementXml; } });
Object.defineProperty(exports, "patchElementXfrm", { enumerable: true, get: function () { return generate_2.patchElementXfrm; } });
Object.defineProperty(exports, "patchElementFill", { enumerable: true, get: function () { return generate_2.patchElementFill; } });
Object.defineProperty(exports, "patchElementPPr", { enumerable: true, get: function () { return generate_2.patchElementPPr; } });
Object.defineProperty(exports, "patchParagraphPPrXml", { enumerable: true, get: function () { return generate_2.patchParagraphPPrXml; } });
Object.defineProperty(exports, "patchElementStroke", { enumerable: true, get: function () { return generate_2.patchElementStroke; } });
Object.defineProperty(exports, "patchBodyPrAutofit", { enumerable: true, get: function () { return generate_2.patchBodyPrAutofit; } });
Object.defineProperty(exports, "patchPictureSrcRect", { enumerable: true, get: function () { return generate_2.patchPictureSrcRect; } });
Object.defineProperty(exports, "patchSlideAdvanceTimeXml", { enumerable: true, get: function () { return generate_2.patchSlideAdvanceTimeXml; } });
Object.defineProperty(exports, "patchSlideBackgroundXml", { enumerable: true, get: function () { return generate_2.patchSlideBackgroundXml; } });
Object.defineProperty(exports, "patchSlideHiddenXml", { enumerable: true, get: function () { return generate_2.patchSlideHiddenXml; } });
Object.defineProperty(exports, "patchSlideTransitionXml", { enumerable: true, get: function () { return generate_2.patchSlideTransitionXml; } });
Object.defineProperty(exports, "readSlideAdvanceTimeXml", { enumerable: true, get: function () { return generate_2.readSlideAdvanceTimeXml; } });
Object.defineProperty(exports, "readSlideHiddenXml", { enumerable: true, get: function () { return generate_2.readSlideHiddenXml; } });
Object.defineProperty(exports, "readSlideTransitionXml", { enumerable: true, get: function () { return generate_2.readSlideTransitionXml; } });
Object.defineProperty(exports, "generateParagraphXml", { enumerable: true, get: function () { return generate_2.generateParagraphXml; } });
Object.defineProperty(exports, "generateXfrmXml", { enumerable: true, get: function () { return generate_2.generateXfrmXml; } });
var insert_2 = require("./insert");
Object.defineProperty(exports, "addElement", { enumerable: true, get: function () { return insert_2.addElement; } });
Object.defineProperty(exports, "addPicture", { enumerable: true, get: function () { return insert_2.addPicture; } });
Object.defineProperty(exports, "deleteElement", { enumerable: true, get: function () { return insert_2.deleteElement; } });
Object.defineProperty(exports, "buildSpXml", { enumerable: true, get: function () { return insert_2.buildSpXml; } });
Object.defineProperty(exports, "buildTableXml", { enumerable: true, get: function () { return insert_2.buildTableXml; } });
Object.defineProperty(exports, "buildGrpSpXml", { enumerable: true, get: function () { return insert_2.buildGrpSpXml; } });
Object.defineProperty(exports, "calcBoundingBox", { enumerable: true, get: function () { return insert_2.calcBoundingBox; } });
var align_1 = require("./align");
Object.defineProperty(exports, "alignRects", { enumerable: true, get: function () { return align_1.alignRects; } });
Object.defineProperty(exports, "distributeRects", { enumerable: true, get: function () { return align_1.distributeRects; } });
var blank_2 = require("./blank");
Object.defineProperty(exports, "createBlankPptx", { enumerable: true, get: function () { return blank_2.createBlankPptx; } });
var background_promote_1 = require("./background-promote");
Object.defineProperty(exports, "promoteSlideBackground", { enumerable: true, get: function () { return background_promote_1.promoteSlideBackground; } });
Object.defineProperty(exports, "isBackgroundLikeElement", { enumerable: true, get: function () { return background_promote_1.isBackgroundLikeElement; } });
var theme_apply_1 = require("./theme-apply");
Object.defineProperty(exports, "applyThemeToArchive", { enumerable: true, get: function () { return theme_apply_1.applyThemeToArchive; } });
Object.defineProperty(exports, "buildColorMap", { enumerable: true, get: function () { return theme_apply_1.buildColorMap; } });
Object.defineProperty(exports, "collectExplicitColors", { enumerable: true, get: function () { return theme_apply_1.collectExplicitColors; } });
Object.defineProperty(exports, "patchThemeXml", { enumerable: true, get: function () { return theme_apply_1.patchThemeXml; } });
Object.defineProperty(exports, "recolorXml", { enumerable: true, get: function () { return theme_apply_1.recolorXml; } });
Object.defineProperty(exports, "remapDeckColors", { enumerable: true, get: function () { return theme_apply_1.remapDeckColors; } });
var xml_utils_2 = require("./xml-utils");
Object.defineProperty(exports, "escapeXmlText", { enumerable: true, get: function () { return xml_utils_2.escapeXmlText; } });
Object.defineProperty(exports, "escapeXmlAttr", { enumerable: true, get: function () { return xml_utils_2.escapeXmlAttr; } });
var format_brush_1 = require("./format-brush");
Object.defineProperty(exports, "extractFormat", { enumerable: true, get: function () { return format_brush_1.extractFormat; } });
Object.defineProperty(exports, "applyFormat", { enumerable: true, get: function () { return format_brush_1.applyFormat; } });
var layout_2 = require("./layout");
Object.defineProperty(exports, "listSlideLayouts", { enumerable: true, get: function () { return layout_2.listSlideLayouts; } });
var builtin_layouts_1 = require("./builtin-layouts");
Object.defineProperty(exports, "BUILTIN_LAYOUTS", { enumerable: true, get: function () { return builtin_layouts_1.BUILTIN_LAYOUTS; } });
Object.defineProperty(exports, "BUILTIN_LAYOUT_PREFIX", { enumerable: true, get: function () { return builtin_layouts_1.BUILTIN_LAYOUT_PREFIX; } });
Object.defineProperty(exports, "builtinLayoutInfos", { enumerable: true, get: function () { return builtin_layouts_1.builtinLayoutInfos; } });
Object.defineProperty(exports, "ensureBuiltinLayout", { enumerable: true, get: function () { return builtin_layouts_1.ensureBuiltinLayout; } });
Object.defineProperty(exports, "shouldOfferBuiltinLayouts", { enumerable: true, get: function () { return builtin_layouts_1.shouldOfferBuiltinLayouts; } });
var placeholder_2 = require("./placeholder");
Object.defineProperty(exports, "parsePlaceholderMap", { enumerable: true, get: function () { return placeholder_2.parsePlaceholderMap; } });
Object.defineProperty(exports, "resolvePlaceholderTransform", { enumerable: true, get: function () { return placeholder_2.resolvePlaceholderTransform; } });
Object.defineProperty(exports, "parseMasterTextStyles", { enumerable: true, get: function () { return placeholder_2.parseMasterTextStyles; } });
Object.defineProperty(exports, "parseLstStyleLevels", { enumerable: true, get: function () { return placeholder_2.parseLstStyleLevels; } });
Object.defineProperty(exports, "placeholderStyleChain", { enumerable: true, get: function () { return placeholder_2.placeholderStyleChain; } });
Object.defineProperty(exports, "mergeTextStyleChain", { enumerable: true, get: function () { return placeholder_2.mergeTextStyleChain; } });
var theme_3 = require("./theme");
Object.defineProperty(exports, "resolveFontRef", { enumerable: true, get: function () { return theme_3.resolveFontRef; } });
var color_1 = require("./color");
Object.defineProperty(exports, "resolveColorNode", { enumerable: true, get: function () { return color_1.resolveColorNode; } });
Object.defineProperty(exports, "applyColorMods", { enumerable: true, get: function () { return color_1.applyColorMods; } });
var chart_1 = require("./chart");
Object.defineProperty(exports, "parseChartXml", { enumerable: true, get: function () { return chart_1.parseChartXml; } });
var notes_1 = require("./notes");
Object.defineProperty(exports, "getSlideNotes", { enumerable: true, get: function () { return notes_1.getSlideNotes; } });
Object.defineProperty(exports, "setSlideNotes", { enumerable: true, get: function () { return notes_1.setSlideNotes; } });
Object.defineProperty(exports, "notesPathForSlide", { enumerable: true, get: function () { return notes_1.notesPathForSlide; } });
Object.defineProperty(exports, "unescapeXml", { enumerable: true, get: function () { return notes_1.unescapeXml; } });
var comments_1 = require("./comments");
Object.defineProperty(exports, "getSlideComments", { enumerable: true, get: function () { return comments_1.getSlideComments; } });
Object.defineProperty(exports, "addSlideComment", { enumerable: true, get: function () { return comments_1.addSlideComment; } });
Object.defineProperty(exports, "deleteSlideComment", { enumerable: true, get: function () { return comments_1.deleteSlideComment; } });
var hyperlink_1 = require("./hyperlink");
Object.defineProperty(exports, "setElementLink", { enumerable: true, get: function () { return hyperlink_1.setElementLink; } });
Object.defineProperty(exports, "getElementLink", { enumerable: true, get: function () { return hyperlink_1.getElementLink; } });
Object.defineProperty(exports, "getSlideLinks", { enumerable: true, get: function () { return hyperlink_1.getSlideLinks; } });
Object.defineProperty(exports, "getRunLinks", { enumerable: true, get: function () { return hyperlink_1.getRunLinks; } });
Object.defineProperty(exports, "ensureRunLinkRels", { enumerable: true, get: function () { return hyperlink_1.ensureRunLinkRels; } });
Object.defineProperty(exports, "encodeRunLink", { enumerable: true, get: function () { return hyperlink_1.encodeRunLink; } });
Object.defineProperty(exports, "decodeRunLink", { enumerable: true, get: function () { return hyperlink_1.decodeRunLink; } });
var chart_insert_2 = require("./chart-insert");
Object.defineProperty(exports, "addChart", { enumerable: true, get: function () { return chart_insert_2.addChart; } });
Object.defineProperty(exports, "buildChartSpaceXml", { enumerable: true, get: function () { return chart_insert_2.buildChartSpaceXml; } });
var smartart_1 = require("./smartart");
Object.defineProperty(exports, "addSmartArt", { enumerable: true, get: function () { return smartart_1.addSmartArt; } });
Object.defineProperty(exports, "buildSmartArtXml", { enumerable: true, get: function () { return smartart_1.buildSmartArtXml; } });
var media_insert_1 = require("./media-insert");
Object.defineProperty(exports, "addMedia", { enumerable: true, get: function () { return media_insert_1.addMedia; } });
Object.defineProperty(exports, "addModel3d", { enumerable: true, get: function () { return media_insert_1.addModel3d; } });
Object.defineProperty(exports, "model3dPartOf", { enumerable: true, get: function () { return media_insert_1.model3dPartOf; } });
Object.defineProperty(exports, "solidPng", { enumerable: true, get: function () { return media_insert_1.solidPng; } });
var headerfooter_1 = require("./headerfooter");
Object.defineProperty(exports, "applyHeaderFooter", { enumerable: true, get: function () { return headerfooter_1.applyHeaderFooter; } });
Object.defineProperty(exports, "readHeaderFooter", { enumerable: true, get: function () { return headerfooter_1.readHeaderFooter; } });
var sections_2 = require("./sections");
Object.defineProperty(exports, "getSections", { enumerable: true, get: function () { return sections_2.getSections; } });
Object.defineProperty(exports, "setSections", { enumerable: true, get: function () { return sections_2.setSections; } });
Object.defineProperty(exports, "addSection", { enumerable: true, get: function () { return sections_2.addSection; } });
Object.defineProperty(exports, "renameSection", { enumerable: true, get: function () { return sections_2.renameSection; } });
Object.defineProperty(exports, "removeSection", { enumerable: true, get: function () { return sections_2.removeSection; } });
Object.defineProperty(exports, "moveSection", { enumerable: true, get: function () { return sections_2.moveSection; } });
Object.defineProperty(exports, "moveSlide", { enumerable: true, get: function () { return sections_2.moveSlide; } });
Object.defineProperty(exports, "normalizeSections", { enumerable: true, get: function () { return sections_2.normalizeSections; } });
var slide_transfer_2 = require("./slide-transfer");
Object.defineProperty(exports, "collectSlideBundle", { enumerable: true, get: function () { return slide_transfer_2.collectSlideBundle; } });
Object.defineProperty(exports, "importSourceLayout", { enumerable: true, get: function () { return slide_transfer_2.importSourceLayout; } });
Object.defineProperty(exports, "materializeSlideBundle", { enumerable: true, get: function () { return slide_transfer_2.materializeSlideBundle; } });
Object.defineProperty(exports, "chooseLayout", { enumerable: true, get: function () { return slide_transfer_2.chooseLayout; } });
Object.defineProperty(exports, "listLayouts", { enumerable: true, get: function () { return slide_transfer_2.listLayouts; } });
var table_edit_2 = require("./table-edit");
Object.defineProperty(exports, "patchTableStyleXml", { enumerable: true, get: function () { return table_edit_2.patchTableStyleXml; } });
Object.defineProperty(exports, "findTableElementInSlide", { enumerable: true, get: function () { return table_edit_2.findTableElementInSlide; } });
Object.defineProperty(exports, "ensureTableStyleXml", { enumerable: true, get: function () { return table_edit_2.ensureTableStyleXml; } });
Object.defineProperty(exports, "TABLE_STYLE_PRESETS", { enumerable: true, get: function () { return table_edit_2.TABLE_STYLE_PRESETS; } });
var master_edit_2 = require("./master-edit");
Object.defineProperty(exports, "listMasterParts", { enumerable: true, get: function () { return master_edit_2.listMasterParts; } });
Object.defineProperty(exports, "parseMasterPart", { enumerable: true, get: function () { return master_edit_2.parseMasterPart; } });
/** Parse one slide from the archive (assembling the inheritance-chain ctx); shared by openPptx and duplicateSlide. */
function parseSlideFromArchive(archive, slidePath) {
    const slideXml = archive.readText(slidePath);
    if (slideXml == null)
        return null;
    const chain = archive.resolveSlideChain(slidePath);
    const ctx = {};
    if (chain.themePath) {
        const themeXml = archive.readText(chain.themePath);
        if (themeXml)
            ctx.theme = (0, theme_1.parseTheme)(themeXml);
    }
    // Placeholder geometry + text style inheritance + background inheritance: layout first, master fallback (read-only)
    const layoutXml = (chain.layoutPath ? archive.readText(chain.layoutPath) : undefined) ?? undefined;
    if (layoutXml) {
        ctx.layoutPlaceholders = (0, placeholder_1.parsePlaceholderMap)(layoutXml, ctx.theme);
        ctx.layoutBg = layoutXml;
    }
    const masterXml = (chain.masterPath ? archive.readText(chain.masterPath) : undefined) ?? undefined;
    if (masterXml) {
        ctx.masterPlaceholders = (0, placeholder_1.parsePlaceholderMap)(masterXml, ctx.theme);
        ctx.masterTextStyles = (0, placeholder_1.parseMasterTextStyles)(masterXml, ctx.theme);
        ctx.masterBg = masterXml;
    }
    // Media rId → zip path; chart rId → chart part content
    const rels = archive.readRels(slidePath);
    const mediaRels = new Map();
    const chartXmls = new Map();
    const avRels = new Map();
    const diagramDrawings = new Map();
    const hlinkRels = new Map();
    let slideOrder;
    for (const rel of rels.values()) {
        if (rel.type.endsWith('/hyperlink')) {
            hlinkRels.set(rel.id, rel.target);
        }
        else if (rel.type.endsWith('/slide')) {
            // Run-level slide jump: resolve the target slide file to its deck index
            slideOrder ??= archive.readPresentation().slidePaths;
            const idx = slideOrder.indexOf((0, zip_1.resolveTarget)(slidePath, rel.target));
            if (idx >= 0)
                hlinkRels.set(rel.id, `slide:${idx}`);
        }
        else if (rel.type.endsWith('/image')) {
            mediaRels.set(rel.id, (0, zip_1.resolveTarget)(slidePath, rel.target));
        }
        else if (rel.type.endsWith('/chart')) {
            const xml = archive.readText((0, zip_1.resolveTarget)(slidePath, rel.target));
            if (xml)
                chartXmls.set(rel.id, xml);
        }
        else if (/\/(?:video|audio|media)$/.test(rel.type)) {
            // Audio/video (r:link of a:videoFile/a:audioFile; embedded or external)
            const external = rel.targetMode === 'External';
            avRels.set(rel.id, {
                target: external ? rel.target : (0, zip_1.resolveTarget)(slidePath, rel.target),
                ...(external ? { external: true } : {}),
            });
        }
        else if (rel.type.endsWith('/diagramData')) {
            // SmartArt prerendered drawing part: the data part's <dsp:dataModelExt relId="…">
            // points at a diagramDrawing relationship in the container part's (slide's) rels; fall back to the data part's own rels
            const dataPath = (0, zip_1.resolveTarget)(slidePath, rel.target);
            const dataXml = archive.readText(dataPath);
            const relId = dataXml
                ? /<dsp:dataModelExt\b[^>]*\brelId="([^"]+)"/.exec(dataXml)?.[1]
                : undefined;
            if (relId) {
                const drawRel = rels.get(relId) ?? archive.readRels(dataPath).get(relId);
                const basePath = rels.get(relId) ? slidePath : dataPath;
                const drawingXml = drawRel
                    ? archive.readText((0, zip_1.resolveTarget)(basePath, drawRel.target))
                    : undefined;
                if (drawingXml)
                    diagramDrawings.set(rel.id, drawingXml);
            }
        }
    }
    ctx.mediaRels = mediaRels;
    ctx.chartXmls = chartXmls;
    if (hlinkRels.size)
        ctx.hlinkRels = hlinkRels;
    if (avRels.size)
        ctx.avRels = avRels;
    if (diagramDrawings.size)
        ctx.diagramDrawings = diagramDrawings;
    // Table style definitions (embedded custom styles; built-in styles handled by table-style as fallback)
    ctx.tableStyles = archive.readText('ppt/tableStyles.xml') ?? undefined;
    const slide = (0, parse_1.parseSlide)({
        path: slidePath,
        slideXml,
        layoutPath: chain.layoutPath,
        masterPath: chain.masterPath,
        ctx,
    });
    // master/layout decoration layer (logos/color bars + enabled footer/slide number/date), read-only render
    const decorations = buildDecorations(archive, slidePath, slideXml, slide, layoutXml, masterXml, {
        layoutPath: chain.layoutPath,
        masterPath: chain.masterPath,
        theme: ctx.theme,
        masterPlaceholders: ctx.masterPlaceholders,
        masterTextStyles: ctx.masterTextStyles,
    });
    if (decorations.length)
        slide.decorations = decorations;
    return slide;
}
/** A part's (layout/master) own image rels (for decoration-layer picture parsing). */
function partMediaRels(archive, partPath) {
    const media = new Map();
    for (const rel of archive.readRels(partPath).values()) {
        if (rel.type.endsWith('/image'))
            media.set(rel.id, (0, zip_1.resolveTarget)(partPath, rel.target));
    }
    return media;
}
/**
 * <p:hf> footer-family toggle state.
 * Actual PowerPoint behavior: enabling footers writes ftr/sldNum/dt placeholders
 * into every slide (rendered as normal elements); same-type placeholders on
 * layout/master are just templates. So the decoration layer doesn't render them
 * by default (unset), and only draws them when hf explicitly enables them (a few
 * generators depend on this).
 */
function hfState(xml, attr) {
    if (!xml)
        return 'unset';
    const hf = /<p:hf\b[^>]*\/?>/.exec(xml)?.[0];
    if (!hf)
        return 'unset';
    if (new RegExp(`\\b${attr}="(?:1|true)"`).test(hf))
        return 'on';
    if (new RegExp(`\\b${attr}="(?:0|false)"`).test(hf))
        return 'off';
    return 'unset';
}
/**
 * Assemble a slide's decoration layer: master concrete shapes (bottom-most) →
 * layout concrete shapes.
 * - showMasterSp="0" on the slide/layout disables the master layer;
 * - Footer-family placeholders (ftr/sldNum/dt) follow the <p:hf> toggles + nearest
 *   override (present on the slide → skip the layout's; present on the layout →
 *   skip the master's);
 * - The slide-number field is replaced with the slide's actual index.
 */
function buildDecorations(archive, slidePath, slideXml, slide, layoutXml, masterXml, parts) {
    const out = [];
    // Slide number: this slide's index in presentation.xml's sldIdLst
    let slideNum;
    try {
        const idx = archive.readPresentation().slidePaths.indexOf(slidePath);
        if (idx >= 0)
            slideNum = idx + 1;
    }
    catch {
        /* missing slide-number substitution is acceptable */
    }
    const HF_ALL = ['ftr', 'sldNum', 'dt'];
    const enabled = new Set(HF_ALL.filter((k) => {
        const l = hfState(layoutXml, k);
        const m = hfState(masterXml, k);
        if (l === 'off' || m === 'off')
            return false;
        return l === 'on' || m === 'on';
    }));
    // Footer-family placeholders the slide already has (nearest override, no longer taken from layout/master)
    const slidePh = new Set(slide.elements.map((e) => e.placeholder).filter(Boolean));
    const hasPh = (xml, type) => !!xml && new RegExp(`<p:ph\\b[^>]*type="${type}"`).test(xml);
    const masterShown = !/<p:sld\b[^>]*showMasterSp="(?:0|false)"/.test(slideXml) &&
        !(layoutXml && /<p:sldLayout\b[^>]*showMasterSp="(?:0|false)"/.test(layoutXml));
    if (masterShown && masterXml && parts.masterPath) {
        const hfTypes = new Set([...enabled].filter((k) => !slidePh.has(k) && !hasPh(layoutXml, k)));
        const ctx = {
            theme: parts.theme,
            mediaRels: partMediaRels(archive, parts.masterPath),
        };
        out.push(...(0, parse_1.parseDecorations)(masterXml, ctx, { hfTypes, ...(slideNum != null ? { slideNum } : {}) }));
    }
    if (layoutXml && parts.layoutPath) {
        const hfTypes = new Set([...enabled].filter((k) => !slidePh.has(k)));
        // Layout footer placeholders often omit xfrm/font size, inheriting from the master
        const ctx = {
            theme: parts.theme,
            mediaRels: partMediaRels(archive, parts.layoutPath),
            masterPlaceholders: parts.masterPlaceholders,
            masterTextStyles: parts.masterTextStyles,
        };
        out.push(...(0, parse_1.parseDecorations)(layoutXml, ctx, { hfTypes, ...(slideNum != null ? { slideNum } : {}) }));
    }
    return out;
}
async function openPptx(bytes) {
    const archive = await zip_1.PackageArchive.open(bytes);
    const { size, slidePaths } = archive.readPresentation();
    const slides = [];
    for (const slidePath of slidePaths) {
        const slide = parseSlideFromArchive(archive, slidePath);
        if (slide)
            slides.push(slide);
    }
    const deck = { slides, size, originalHash: archive.originalHash };
    return { deck, archive };
}
/**
 * Rebuild the deck model from the archive's current entries — same result as
 * openPptx(await savePptx(opened)) without materializing the zip, whose contiguous
 * output buffer fails outright on large decks. Pending edits must already be baked
 * into the entries (commitSaved).
 */
function reparseDeck(opened) {
    const { archive } = opened;
    const { size, slidePaths } = archive.readPresentation();
    const slides = [];
    for (const slidePath of slidePaths) {
        const slide = parseSlideFromArchive(archive, slidePath);
        if (slide)
            slides.push(slide);
    }
    return { deck: { slides, size, originalHash: archive.originalHash }, archive };
}
/**
 * Save (element-level patches, Phase 3.3).
 *
 * - With no dirty elements: write original entries back byte-for-byte, producing a
 *   slideN.xml 100% identical to the original.
 * - Slides with dirty elements: rebuild that slideN.xml = bodyPrefix + each element
 *   (dirty ? patch-regenerated : original byte slice) + bodySuffix; all other
 *   entries are copied byte-for-byte.
 * - Non-text elements (pictures/passthrough) don't support content editing yet;
 *   even flagged dirty they use original bytes.
 */
async function savePptx(opened) {
    return buildZip(opened).generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
    });
}
/**
 * Same output as savePptx, written straight to `filePath`.
 *
 * Prefer this for anything that lands on disk: savePptx has to assemble the whole
 * package into one contiguous buffer, which on a large deck fails outright with
 * "Array buffer allocation failed". Streaming keeps peak memory to a chunk at a
 * time. JSZip throws stream errors from inside its own scheduled callbacks, so the
 * stream's 'error' event — not just the returned promise — has to be handled or the
 * throw escapes as an uncaught exception and takes the process down.
 */
async function savePptxToFile(opened, filePath) {
    const { createWriteStream } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    const source = buildZip(opened).generateNodeStream({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
        streamFiles: true,
    });
    await pipeline(source, createWriteStream(filePath));
}
/**
 * Sync the in-memory model with what savePptx/savePptxToFile just wrote, without
 * the full reopen (readFile + sha256 + unzip + reparse) that used to double save
 * latency and peak memory on large decks.
 *
 * For every dirty slide this bakes the patched XML back into archive.entries and
 * anchor.originalXml, then clears the dirty flags — exactly the state a reopen
 * would produce, minus new element ids. Uses the same patchSlideXml /
 * patchedElementXml pair as buildZip, so memory and disk are byte-identical and
 * the next save's byte slices are safe to reuse.
 *
 * Call only after a successful save; on failure keep the dirty state so the next
 * save retries the patches.
 */
function commitSaved(opened) {
    const { deck, archive } = opened;
    for (const slide of deck.slides) {
        if (!slideIsDirty(slide))
            continue;
        const xml = patchSlideXml(slide);
        for (const el of slide.elements) {
            el.anchor.originalXml = patchedElementXml(el);
            delete el.dirty;
            delete el.dirtyTransform;
            delete el.dirtyFill;
            delete el.dirtyStroke;
            delete el.dirtySrcRect;
            delete el.dirtyPPr;
        }
        slide.originalXml = xml;
        delete slide.structureDirty;
        archive.entries.set(slide.path, Buffer.from(xml, 'utf8'));
    }
}
/**
 * Only XML text parts benefit from deflate. Everything else (media, fonts, OLE
 * blobs) is already compressed or opaque binary: deflating it burns seconds of
 * CPU on large decks for no size win, so it is stored verbatim.
 */
const COMPRESSED_EXTENSIONS = new Set(['xml', 'rels']);
function slideIsDirty(s) {
    return (!!s.structureDirty ||
        s.elements.some((e) => e.dirty || e.dirtyTransform || e.dirtyFill || e.dirtyStroke || e.dirtySrcRect || e.dirtyPPr));
}
function buildZip(opened) {
    const { deck, archive } = opened;
    const dirtyByPath = new Map();
    for (const s of deck.slides) {
        if (slideIsDirty(s))
            dirtyByPath.set(s.path, s);
    }
    const zip = new jszip_1.default();
    for (const [path, data] of archive.entries) {
        const slide = dirtyByPath.get(path);
        if (slide) {
            zip.file(path, patchSlideXml(slide));
            continue;
        }
        const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
        zip.file(path, data, COMPRESSED_EXTENSIONS.has(ext) ? {} : { compression: 'STORE' });
    }
    return zip;
}
/**
 * Rebuild one slideN.xml: dirty elements are patch-regenerated, the rest pass
 * through as original bytes. With no dirty elements the result == originalXml.
 */
function patchSlideXml(slide) {
    const parts = [slide.bodyPrefix];
    for (const el of slide.elements) {
        parts.push(patchedElementXml(el));
        if (el.anchor.gapAfter)
            parts.push(el.anchor.gapAfter);
    }
    parts.push(slide.bodySuffix);
    return parts.join('');
}
/** One element's current XML slice (dirty elements patch-regenerated, clean elements original bytes). */
function patchedElementXml(el) {
    let xml = el.anchor.originalXml;
    if (el.dirty && (el.type === 'text' || el.type === 'shape')) {
        xml = (0, generate_1.patchTextElementXml)(el, xml);
    }
    // Surgical paragraph-property patch (run bytes untouched); paragraph count mismatch (rare) falls back to a full rebuild
    if (el.dirtyPPr && (el.type === 'text' || el.type === 'shape') && el.text) {
        const t = el;
        xml = (0, generate_1.patchElementPPr)(t, xml, el.dirtyPPr) ?? (0, generate_1.rebuildTxBody)(t, xml);
    }
    // graphicFrame (table/chart/passthrough) uses the p:xfrm patch, everything else a:xfrm
    if (el.dirtyTransform) {
        xml = (0, generate_1.patchElementXfrm)(el, xml);
    }
    if (el.dirtyFill && (el.type === 'text' || el.type === 'shape')) {
        const fill = el.fill;
        if (fill?.type === 'solid')
            xml = (0, generate_1.patchElementFill)(xml, fill.color);
        else if (fill?.type === 'none')
            xml = (0, generate_1.patchElementFill)(xml, 'none');
        else if (fill?.type === 'gradient') {
            xml = (0, generate_1.patchElementFill)(xml, {
                stops: fill.stops,
                ...(fill.angle != null ? { angle: fill.angle } : {}),
                ...(fill.path ? { radial: true } : {}),
            });
        }
    }
    if (el.dirtyStroke && (el.type === 'text' || el.type === 'shape' || el.type === 'picture')) {
        const stroke = el.stroke;
        xml = (0, generate_1.patchElementStroke)(xml, stroke && stroke.fill.type === 'solid'
            ? { color: stroke.fill.color, widthEmu: stroke.width, dash: stroke.dash }
            : null);
    }
    if (el.dirtySrcRect && el.type === 'picture') {
        const pic = el;
        xml = (0, generate_1.patchPictureSrcRect)(xml, pic.srcRect ?? null);
    }
    return xml;
}
/** Set a solid slide background: patch the bodyPrefix and sync the model (written back with the whole-slide rebuild on save). */
function setSlideBackground(slide, color) {
    slide.bodyPrefix = (0, generate_1.patchSlideBackgroundXml)(slide.bodyPrefix, color);
    slide.background = { type: 'solid', color };
    slide.structureDirty = true;
}
/**
 * Update a picture element's srcRect crop (0..1 fractions, null = full image).
 * Flags dirtySrcRect so save surgically patches <a:srcRect>; no other bytes are
 * touched. Returns whether the element was found and updated.
 */
function editPictureSrcRect(slide, sourceId, srcRect) {
    const el = slide.elements.find((e) => e.id === sourceId && e.type === 'picture');
    if (!el)
        return false;
    const pic = el;
    if (srcRect && !srcRect.l && !srcRect.t && !srcRect.r && !srcRect.b) {
        pic.srcRect = undefined;
    }
    else {
        pic.srcRect = srcRect ?? undefined;
    }
    pic.dirtySrcRect = true;
    return true;
}
/**
 * Text-box vertical alignment (bodyPr anchor: t/ctr/b). Byte surgery baked directly into originalXml.
 */
function setElementTextAnchor(slide, elementId, anchor) {
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el || (el.type !== 'text' && el.type !== 'shape'))
        return false;
    const t = el;
    if (!t.text)
        return false;
    let xml = patchedElementXml(el);
    const val = anchor === 'middle' ? 'ctr' : anchor === 'bottom' ? 'b' : 't';
    const m = /<a:bodyPr\b[^>]*?\/?>/.exec(xml);
    if (!m)
        return false;
    let tag = m[0].replace(/\s+anchor="[^"]*"/, '');
    tag = tag.replace(/^<a:bodyPr/, `<a:bodyPr anchor="${val}"`);
    xml = xml.slice(0, m.index) + tag + xml.slice(m.index + m[0].length);
    el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false;
    el.dirtyPPr = undefined;
    el.anchor.originalXml = xml;
    t.text.anchor = anchor;
    slide.structureDirty = true;
    return true;
}
/**
 * Shape image fill: after landing the image in the package (media + rels), the
 * spPr fill node is replaced with a blipFill, byte surgery baked directly into
 * originalXml. Returns the mediaPath (for render-layer decoding), null on failure.
 */
function setElementImageFill(opened, slide, elementId, bytes, ext) {
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el || (el.type !== 'text' && el.type !== 'shape'))
        return null;
    const added = (0, insert_1.addImageMediaAndRel)(opened, slide, bytes, ext);
    if (!added)
        return null;
    const rawFillXml = `<a:blipFill rotWithShape="1"><a:blip r:embed="${added.rid}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`;
    const xml = (0, generate_1.patchElementFill)(patchedElementXml(el), { rawFillXml });
    el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false;
    el.dirtyPPr = undefined;
    el.anchor.originalXml = xml;
    el.fill = { type: 'image', mediaRef: added.mediaPath, mode: 'stretch' };
    slide.structureDirty = true;
    return added.mediaPath;
}
/**
 * Whole-picture opacity (0..1; ≥1 clears alphaModFix). Byte surgery on the
 * <a:blip> child, baked directly into originalXml (no separate dirty flag).
 */
function setPictureOpacity(slide, sourceId, opacity) {
    const el = slide.elements.find((e) => e.id === sourceId && e.type === 'picture');
    if (!el)
        return false;
    const pic = el;
    let xml = patchedElementXml(el);
    xml = xml.replace(/<a:alphaModFix\b[^>]*\/>|<a:alphaModFix\b[^>]*>[\s\S]*?<\/a:alphaModFix>/, '');
    const v = Math.max(0, Math.min(1, opacity));
    if (v < 0.999) {
        const amt = `<a:alphaModFix amt="${Math.round(v * 100000)}"/>`;
        if (/<a:blip\b[^>]*\/>/.test(xml)) {
            xml = xml.replace(/<a:blip\b([^>]*)\/>/, `<a:blip$1>${amt}</a:blip>`);
        }
        else if (/<a:blip\b[^>]*>/.test(xml)) {
            xml = xml.replace(/(<a:blip\b[^>]*>)/, `$1${amt}`);
        }
        else {
            return false;
        }
        pic.opacity = v;
    }
    else {
        delete pic.opacity;
    }
    el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false;
    el.dirtySrcRect = false;
    el.dirtyPPr = undefined;
    el.anchor.originalXml = xml;
    slide.structureDirty = true;
    return true;
}
/**
 * Swap a picture's backing image for new bytes, keeping frame, z-order, border
 * and effects. New media part + rel; the <a:blip> reference is re-pointed via
 * byte surgery baked into originalXml (same pattern as setPictureOpacity).
 * srcRect is kept only when the caller knows the new image shares the old one's
 * pixel geometry (e.g. background-removal output) — otherwise the stale crop
 * would show an arbitrary window of the new image.
 */
function replacePictureBytes(opened, slide, sourceId, bytes, ext, opts) {
    const el = slide.elements.find((e) => e.id === sourceId && e.type === 'picture');
    if (!el)
        return false;
    const pic = el;
    let xml = patchedElementXml(el);
    const blip = /<a:blip\b[^>]*\/?>/.exec(xml);
    if (!blip)
        return false;
    const added = (0, insert_1.addImageMediaAndRel)(opened, slide, bytes, ext);
    if (!added)
        return false;
    let tag = blip[0];
    // A coexisting r:link ("insert and link" pictures) would keep refreshing from
    // the old external file, so it is dropped once the embed points at new bytes
    if (/r:embed="/.test(tag))
        tag = tag.replace(/r:embed="[^"]*"/, `r:embed="${added.rid}"`).replace(/\s+r:link="[^"]*"/, '');
    else if (/r:link="/.test(tag))
        tag = tag.replace(/r:link="[^"]*"/, `r:embed="${added.rid}"`);
    else
        tag = tag.replace(/<a:blip\b/, `<a:blip r:embed="${added.rid}"`);
    xml = xml.slice(0, blip.index) + tag + xml.slice(blip.index + blip[0].length);
    // The replacement is always raster (IMAGE_MIME gate), and PowerPoint prefers a
    // leftover Office-2016 <asvg:svgBlip> extension over the retargeted r:embed —
    // drop that extension entry (and its wrapper when nothing else remains)
    xml = xml
        .replace(/<a:ext\b[^>]*>\s*<\w+:svgBlip\b[\s\S]*?<\/a:ext>/, '')
        .replace(/<a:extLst>\s*<\/a:extLst>/, '');
    if (!opts?.keepSrcRect) {
        xml = xml.replace(/<a:srcRect\b[^>]*\/>|<a:srcRect\b[^>]*>[\s\S]*?<\/a:srcRect>/, '');
        delete pic.srcRect;
    }
    pic.mediaRef = added.mediaPath;
    delete pic.dataUrl; // the media resolver re-derives it from the new mediaRef
    el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false;
    el.dirtySrcRect = false;
    el.dirtyPPr = undefined;
    el.anchor.originalXml = xml;
    slide.structureDirty = true;
    return true;
}
// ── New slides (duplicate an existing slide / blank slide) ────────────
const SLIDE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const SLIDE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
/** New slide part path: number = existing max + 1. */
function nextSlidePath(archive) {
    let maxNum = 0;
    for (const path of archive.entries.keys()) {
        const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(path);
        if (m)
            maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `ppt/slides/slide${maxNum + 1}.xml`;
}
/**
 * Register a new slide part (already written into the archive) with the package
 * and insert it into the deck: add an Override to [Content_Types].xml, register a
 * new sldId/rId in presentation.xml(.rels) (inserted after the sourceIndex slide's
 * sldId), and splice the parsed new slide model into deck.slides.
 */
function registerNewSlide(opened, sourceIndex, newPath) {
    const { deck, archive } = opened;
    const src = deck.slides[sourceIndex];
    if (!src)
        return null;
    const ctPath = '[Content_Types].xml';
    const ct = archive.readText(ctPath);
    if (ct) {
        const override = `<Override PartName="/${newPath}" ContentType="${SLIDE_CONTENT_TYPE}"/>`;
        archive.entries.set(ctPath, Buffer.from(ct.replace('</Types>', `${override}</Types>`), 'utf8'));
    }
    const presRelsPath = 'ppt/_rels/presentation.xml.rels';
    const presRels = archive.readText(presRelsPath);
    const presPath = 'ppt/presentation.xml';
    const pres = archive.readText(presPath);
    if (!presRels || !pres)
        return null;
    let maxRid = 0;
    for (const m of presRels.matchAll(/Id="rId(\d+)"/g))
        maxRid = Math.max(maxRid, Number(m[1]));
    const newRid = `rId${maxRid + 1}`;
    const relXml = `<Relationship Id="${newRid}" Type="${SLIDE_REL_TYPE}" Target="${newPath.slice('ppt/'.length)}"/>`;
    archive.entries.set(presRelsPath, Buffer.from(presRels.replace('</Relationships>', `${relXml}</Relationships>`), 'utf8'));
    let maxSldId = 255;
    for (const m of pres.matchAll(/<p:sldId\s[^>]*\bid="(\d+)"/g)) {
        maxSldId = Math.max(maxSldId, Number(m[1]));
    }
    const newSldId = `<p:sldId id="${maxSldId + 1}" r:id="${newRid}"/>`;
    // Insert after the source slide's sldId; append to the end of the list when not found
    const srcRid = [...archive.readRels(presPath).values()].find((r) => (0, zip_1.resolveTarget)(presPath, r.target) === src.path)?.id;
    const srcTag = srcRid
        ? new RegExp(`<p:sldId\\s[^>]*r:id="${srcRid}"[^>]*/>`).exec(pres)?.[0]
        : undefined;
    const nextPres = srcTag
        ? pres.replace(srcTag, `${srcTag}${newSldId}`)
        : pres.replace('</p:sldIdLst>', `${newSldId}</p:sldIdLst>`);
    archive.entries.set(presPath, Buffer.from(nextPres, 'utf8'));
    const slide = parseSlideFromArchive(archive, newPath);
    if (!slide)
        return null;
    deck.slides.splice(sourceIndex + 1, 0, slide);
    return slide;
}
/**
 * Duplicate the sourceIndex slide as a new slide inserted after it; returns the
 * new slide model.
 *
 * The new slideK.xml includes the source slide's unsaved patches; rels are copied
 * verbatim but with notesSlide removed, so two slides don't share the same notes.
 */
function duplicateSlide(opened, sourceIndex, opts) {
    const { deck, archive } = opened;
    const src = deck.slides[sourceIndex];
    if (!src)
        return null;
    const newPath = nextSlidePath(archive);
    archive.entries.set(newPath, Buffer.from(patchSlideXml(src), 'utf8'));
    const srcRels = archive.readText((0, zip_1.relsPathFor)(src.path));
    if (srcRels) {
        const cleaned = srcRels.replace(/<Relationship\s[^>]*\/notesSlide"[^>]*\/>/g, '');
        archive.entries.set((0, zip_1.relsPathFor)(newPath), Buffer.from(cleaned, 'utf8'));
    }
    const slide = registerNewSlide(opened, sourceIndex, newPath);
    if (!slide)
        return null;
    if (opts?.clearText) {
        for (const el of slide.elements) {
            if ((el.type === 'text' || el.type === 'shape') && el.text) {
                ;
                el.text.paragraphs = [{ runs: [{ text: '' }] }];
                el.dirty = true;
            }
        }
    }
    return slide;
}
/**
 * Snapshot a slide for pasting into another deck (or back into this one),
 * including its unsaved edits and every part it references.
 */
function copySlide(opened, sourceIndex) {
    const slide = opened.deck.slides[sourceIndex];
    if (!slide)
        return null;
    return (0, slide_transfer_1.collectSlideBundle)(opened.archive, slide.path, patchSlideXml(slide));
}
/**
 * Paste a bundle after `afterIndex` (-1 pastes at the front). By default the
 * slide adopts a layout from this deck — matched by the source layout's name,
 * else the neighbour's — so it takes on the destination theme ("use destination
 * theme"). With `keepSourceFormatting` the bundled layout→master→theme chain is
 * imported instead, so the slide keeps its source look; falls back to the
 * destination theme when the bundle carries no chain.
 */
function pasteSlide(opened, afterIndex, bundle, opts) {
    const { deck, archive } = opened;
    if (deck.slides.length === 0)
        return null;
    const anchorIndex = Math.min(Math.max(afterIndex, -1), deck.slides.length - 1);
    const neighbour = deck.slides[anchorIndex] ?? deck.slides[0];
    const layoutPath = (opts?.keepSourceFormatting ? (0, slide_transfer_1.importSourceLayout)(archive, bundle) : null) ??
        (0, slide_transfer_1.chooseLayout)(archive, bundle, neighbour?.path);
    if (!layoutPath)
        return null;
    const newPath = nextSlidePath(archive);
    const relsXml = (0, slide_transfer_1.materializeSlideBundle)(archive, bundle, newPath, layoutPath);
    archive.entries.set(newPath, Buffer.from(bundle.slideXml, 'utf8'));
    archive.entries.set((0, zip_1.relsPathFor)(newPath), Buffer.from(relsXml, 'utf8'));
    if (anchorIndex < 0) {
        // registerNewSlide can only insert after a slide, so land at 1 and move up
        const slide = registerNewSlide(opened, 0, newPath);
        if (slide)
            (0, sections_1.moveSlide)(opened, deck.slides.indexOf(slide), 0);
        return slide;
    }
    return registerNewSlide(opened, anchorIndex, newPath);
}
/**
 * Insert a truly blank slide after the sourceIndex slide: content is an empty
 * spTree, rels only point at the source slide's slideLayout — layout/master
 * background and decorations carry over, slide elements are empty.
 */
function insertBlankSlide(opened, sourceIndex) {
    const { deck, archive } = opened;
    const src = deck.slides[sourceIndex];
    if (!src)
        return null;
    const newPath = nextSlidePath(archive);
    archive.entries.set(newPath, Buffer.from(blank_1.BLANK_SLIDE_XML, 'utf8'));
    // Both slides live under ppt/slides/, so the source layout relationship's relative Target can be reused directly
    const layout = [...archive.readRels(src.path).values()].find((r) => r.type.endsWith('/slideLayout'));
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        (layout
            ? `<Relationship Id="rId1" Type="${layout.type}" Target="${(0, xml_utils_1.escapeXmlAttr)(layout.target)}"/>`
            : '') +
        '</Relationships>';
    archive.entries.set((0, zip_1.relsPathFor)(newPath), Buffer.from(rels, 'utf8'));
    return registerNewSlide(opened, sourceIndex, newPath);
}
const IMAGE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const LAYOUT_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout';
const MEDIA_REL_SUFFIXES = ['/image', '/video', '/audio', '/media'];
/** Next non-conflicting media path in the target archive (keeping the extension). */
function nextMediaPath(archive, ext) {
    let maxNum = 0;
    for (const path of archive.entries.keys()) {
        const m = /^ppt\/media\/merged(\d+)\./.exec(path);
        if (m)
            maxNum = Math.max(maxNum, Number(m[1]));
    }
    return `ppt/media/merged${maxNum + 1}.${ext}`;
}
/** Ensure [Content_Types].xml has a Default for this extension (required for images/media). */
function ensureDefaultContentType(archive, ext, contentType) {
    const ctPath = '[Content_Types].xml';
    const ct = archive.readText(ctPath);
    if (!ct)
        return;
    if (new RegExp(`<Default\\s[^>]*Extension="${ext}"`, 'i').test(ct))
        return;
    // Insert the Default after the root <Types …> open tag (after the first >)
    const def = `<Default Extension="${ext}" ContentType="${contentType}"/>`;
    const at = ct.indexOf('>') + 1;
    archive.entries.set(ctPath, Buffer.from(ct.slice(0, at) + def + ct.slice(at), 'utf8'));
}
const MIME_BY_EXT = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    emf: 'image/x-emf',
    wmf: 'image/x-wmf',
};
/**
 * Merge the single slide of a one-slide pptx into the target deck (appended at
 * the end).
 *
 * Used by the html→pptx pipeline's per-slide independent conversion: each slide's
 * HTML converts into its own single-slide pptx, and on landing that slide is moved
 * into the existing deck **without reconverting earlier slides**.
 *
 * Precondition (pipeline homogeneity): all single-slide pptx files share the same
 * layout/master/theme structure, so the appended slide reuses the target's
 * existing slideLayout (the source's layout/master/theme is not imported); only
 * the slide XML + the media it references are moved (rIds reassigned to avoid
 * cross-slide name clashes), notesSlide dropped.
 */
async function mergeSlideFromPptx(target, sourceBytes) {
    const { deck, archive } = target;
    const src = await zip_1.PackageArchive.open(sourceBytes);
    const { slidePaths } = src.readPresentation();
    const srcSlidePath = slidePaths[0];
    if (!srcSlidePath)
        return null;
    let slideXml = src.readText(srcSlidePath);
    if (slideXml == null)
        return null;
    const srcRels = src.readRels(srcSlidePath);
    // Relative Target of any existing target slide's slideLayout (the appended slide reuses the same layout)
    const anchorSlide = deck.slides[deck.slides.length - 1];
    const layoutTarget = anchorSlide
        ? [...archive.readRels(anchorSlide.path).values()].find((r) => r.type.endsWith('/slideLayout'))
            ?.target
        : undefined;
    const newPath = nextSlidePath(archive);
    const newRelsLines = [];
    let ridSeq = 0;
    const nextRid = () => `rId${++ridSeq}`;
    for (const rel of srcRels.values()) {
        if (MEDIA_REL_SUFFIXES.some((s) => rel.type.endsWith(s))) {
            // Media: move source bytes into the target, assign a non-conflicting path, remap the rId
            const srcMediaPath = (0, zip_1.resolveTarget)(srcSlidePath, rel.target);
            const bytes = src.readBytes(srcMediaPath);
            if (!bytes)
                continue;
            const ext = (srcMediaPath.split('.').pop() || 'png').toLowerCase();
            const destPath = nextMediaPath(archive, ext);
            archive.entries.set(destPath, bytes);
            ensureDefaultContentType(archive, ext, MIME_BY_EXT[ext] ?? 'application/octet-stream');
            const oldRid = rel.id;
            const newRid = nextRid();
            // Rewrite r:embed / r:link references in the slide XML to the new rId
            slideXml = slideXml.replace(new RegExp(`(r:(?:embed|link)=")${oldRid}(")`, 'g'), `$1${newRid}$2`);
            const relTarget = '../media/' + destPath.slice('ppt/media/'.length);
            newRelsLines.push(`<Relationship Id="${newRid}" Type="${IMAGE_REL_TYPE}" Target="${(0, xml_utils_1.escapeXmlAttr)(relTarget)}"/>`);
        }
        else if (rel.type.endsWith('/slideLayout')) {
            // Reuse the target's existing layout; the source slide XML doesn't reference the layout's rId (layout lives only in rels),
            // but the slide part must have one slideLayout relationship. Use the target's layoutTarget (or the source's when absent).
            const t = layoutTarget ?? rel.target;
            newRelsLines.push(`<Relationship Id="${nextRid()}" Type="${LAYOUT_REL_TYPE}" Target="${(0, xml_utils_1.escapeXmlAttr)(t)}"/>`);
            // With no target layout (rare: empty deck), move the source's whole layout→master→theme chain over
            if (!layoutTarget)
                importLayoutChain(src, archive, srcSlidePath);
        }
        // notesSlide and others (e.g. comments) are dropped
    }
    // Write the new slide XML + rels
    archive.entries.set(newPath, Buffer.from(slideXml, 'utf8'));
    const relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        newRelsLines.join('') +
        '</Relationships>';
    archive.entries.set((0, zip_1.relsPathFor)(newPath), Buffer.from(relsXml, 'utf8'));
    // Register with the package: Content_Types Override + new sldId/rId in presentation.xml(.rels), inserted at the end
    return registerNewSlide(target, deck.slides.length - 1, newPath);
}
/** Starting from an empty deck: move the source single slide's layout→master→theme chain into the target verbatim (rare branch). */
function importLayoutChain(src, archive, srcSlidePath) {
    const chain = src.resolveSlideChain(srcSlidePath);
    for (const p of [chain.layoutPath, chain.masterPath, chain.themePath]) {
        if (!p)
            continue;
        const b = src.readBytes(p);
        if (b && !archive.has(p))
            archive.entries.set(p, b);
        const rp = (0, zip_1.relsPathFor)(p);
        const rb = src.readBytes(rp);
        if (rb && !archive.has(rp))
            archive.entries.set(rp, rb);
    }
}
/**
 * Insert a blank slide after the sourceIndex slide, with rels pointing at the
 * given layoutPath (from listSlideLayouts). The layout itself is read-only, never
 * written back. Returns the new Slide, or null on failure.
 */
function insertSlideWithLayout(opened, sourceIndex, layoutPath) {
    const newPath = (0, layout_1.prepareInsertSlideWithLayout)(opened.archive, opened.deck, sourceIndex, layoutPath);
    if (!newPath)
        return null;
    const slide = parseSlideFromArchive(opened.archive, newPath);
    if (!slide)
        return null;
    // prepareInsertSlideWithLayout already registered presentation.xml
    // Here we only splice into deck.slides (no further archive changes needed)
    opened.deck.slides.splice(sourceIndex + 1, 0, slide);
    return slide;
}
/**
 * Delete a slide: the sldId in presentation.xml, the presentation rels, the
 * [Content_Types] Override, the slide part and its rels are all removed;
 * deck.slides synced. Refused when only one slide remains.
 */
function deleteSlide(opened, index) {
    const { deck, archive } = opened;
    const slide = deck.slides[index];
    if (!slide || deck.slides.length <= 1)
        return false;
    const presPath = 'ppt/presentation.xml';
    const presRelsPath = 'ppt/_rels/presentation.xml.rels';
    const pres = archive.readText(presPath);
    const presRels = archive.readText(presRelsPath);
    if (!pres || !presRels)
        return false;
    const rid = [...archive.readRels(presPath).values()].find((r) => (0, zip_1.resolveTarget)(presPath, r.target) === slide.path)?.id;
    if (!rid)
        return false;
    const sldTag = new RegExp(`<p:sldId\\s[^>]*r:id="${rid}"[^>]*/>`).exec(pres)?.[0];
    if (!sldTag)
        return false;
    archive.entries.set(presPath, Buffer.from(pres.replace(sldTag, ''), 'utf8'));
    const relTag = new RegExp(`<Relationship\\s[^>]*Id="${rid}"[^>]*/>`).exec(presRels)?.[0];
    if (relTag) {
        archive.entries.set(presRelsPath, Buffer.from(presRels.replace(relTag, ''), 'utf8'));
    }
    const ctPath = '[Content_Types].xml';
    const ct = archive.readText(ctPath);
    if (ct) {
        const override = new RegExp(`<Override PartName="/${slide.path.replace(/[.\\/]/g, '\\$&')}"[^>]*/>`).exec(ct)?.[0];
        if (override)
            archive.entries.set(ctPath, Buffer.from(ct.replace(override, ''), 'utf8'));
    }
    archive.entries.delete(slide.path);
    archive.entries.delete((0, zip_1.relsPathFor)(slide.path));
    deck.slides.splice(index, 1);
    return true;
}
/** Adjust an element's z-order (the elements array order is the spTree order); returns whether anything changed. */
function reorderElement(slide, elementId, dir) {
    const idx = slide.elements.findIndex((e) => e.id === elementId);
    if (idx < 0)
        return false;
    const to = dir === 'front'
        ? slide.elements.length - 1
        : dir === 'back'
            ? 0
            : dir === 'forward'
                ? idx + 1
                : idx - 1;
    if (to === idx || to < 0 || to >= slide.elements.length)
        return false;
    const [el] = slide.elements.splice(idx, 1);
    slide.elements.splice(to, 0, el);
    slide.structureDirty = true;
    return true;
}
// ── Raw slice append + whole-slide reparse (shared by paste/table insert) ──
/**
 * Write the slide's current state (incl. unsaved patches) back to the archive and
 * reparse, replacing the model in the deck. New elements appended as raw XML
 * slices go through here, gaining a full semantic model for any element type.
 * Note: after reparse all element ids on the slide change; the caller must rebuild
 * the render tree for the whole slide.
 */
function materializeSlide(opened, slideIndex) {
    const { deck, archive } = opened;
    const slide = deck.slides[slideIndex];
    if (!slide)
        return null;
    archive.entries.set(slide.path, Buffer.from(patchSlideXml(slide), 'utf8'));
    const fresh = parseSlideFromArchive(archive, slide.path);
    if (!fresh)
        return null;
    deck.slides[slideIndex] = fresh;
    return fresh;
}
// ── Connector move-following ────────────────────────────────────────────
/** Connection point index → shape edge midpoint (rectangle approximation: 0 top 1 left 2 bottom 3 right, else center). */
function connectionPoint(t, idx) {
    const o = t.offset;
    switch (idx) {
        case 0:
            return { x: o.x + o.cx / 2, y: o.y };
        case 1:
            return { x: o.x, y: o.y + o.cy / 2 };
        case 2:
            return { x: o.x + o.cx / 2, y: o.y + o.cy };
        case 3:
            return { x: o.x + o.cx, y: o.y + o.cy / 2 };
        default:
            return { x: o.x + o.cx / 2, y: o.y + o.cy / 2 };
    }
}
/**
 * Re-lay connectors after connected shapes move: the geometry box = the bounding
 * box of the two endpoints, direction expressed via flip (exact for straight
 * connectors; elbow connectors approximated by the same bounding box). An
 * unattached end keeps its current endpoint. Returns the number of connectors
 * updated (>0 means each is flagged dirtyTransform).
 */
function updateConnectorsForMoved(slide, movedIds) {
    const movedSpids = new Set();
    for (const id of movedIds) {
        const el = slide.elements.find((e) => e.id === id);
        const spid = el ? (0, animation_1.elementSpid)(el) : null;
        if (spid != null)
            movedSpids.add(spid);
    }
    if (!movedSpids.size)
        return 0;
    const bySpid = new Map();
    for (const e of slide.elements) {
        const spid = (0, animation_1.elementSpid)(e);
        if (spid != null)
            bySpid.set(spid, e);
    }
    let n = 0;
    for (const el of slide.elements) {
        const cxn = el.connection;
        if (!cxn)
            continue;
        if (!((cxn.start && movedSpids.has(cxn.start.id)) || (cxn.end && movedSpids.has(cxn.end.id))))
            continue;
        const t = el.transform;
        const o = t.offset;
        const curStart = { x: t.flipH ? o.x + o.cx : o.x, y: t.flipV ? o.y + o.cy : o.y };
        const curEnd = { x: t.flipH ? o.x : o.x + o.cx, y: t.flipV ? o.y : o.y + o.cy };
        const stTarget = cxn.start ? bySpid.get(cxn.start.id) : undefined;
        const endTarget = cxn.end ? bySpid.get(cxn.end.id) : undefined;
        const p1 = stTarget ? connectionPoint(stTarget.transform, cxn.start.idx) : curStart;
        const p2 = endTarget ? connectionPoint(endTarget.transform, cxn.end.idx) : curEnd;
        t.offset = {
            x: Math.round(Math.min(p1.x, p2.x)),
            y: Math.round(Math.min(p1.y, p2.y)),
            cx: Math.round(Math.abs(p2.x - p1.x)),
            cy: Math.round(Math.abs(p2.y - p1.y)),
        };
        t.flipH = p1.x > p2.x;
        t.flipV = p1.y > p2.y;
        el.dirtyTransform = true;
        n++;
    }
    return n;
}
/**
 * Write/clear a connector's shape attachments (<a:stCxn>/<a:endCxn> in
 * p:cNvCxnSpPr; id = target shape's cNvPr id, idx = connection point index).
 * undefined leaves that end unchanged, null detaches it. Byte surgery baked
 * directly into originalXml (pending patches are materialized first).
 */
function setElementConnection(slide, elementId, patch) {
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el)
        return false;
    let xml = patchedElementXml(el);
    // Normalize self-closing <p:cNvCxnSpPr/> so children can be inserted
    xml = xml.replace(/<p:cNvCxnSpPr([^>]*)\/>/, '<p:cNvCxnSpPr$1></p:cNvCxnSpPr>');
    const m = /<p:cNvCxnSpPr([^>]*)>([\s\S]*?)<\/p:cNvCxnSpPr>/.exec(xml);
    if (!m)
        return false;
    const curSt = /<a:stCxn\b[^>]*\/>/.exec(m[2])?.[0] ?? '';
    const curEnd = /<a:endCxn\b[^>]*\/>/.exec(m[2])?.[0] ?? '';
    let rest = m[2].replace(/<a:stCxn\b[^>]*\/>|<a:endCxn\b[^>]*\/>/g, '');
    // Schema order: cxnSpLocks? stCxn? endCxn? extLst?
    let locks = '';
    const lockM = /<a:cxnSpLocks\b[^>]*(?:\/>|>[\s\S]*?<\/a:cxnSpLocks>)/.exec(rest);
    if (lockM) {
        locks = lockM[0];
        rest = rest.replace(lockM[0], '');
    }
    const tag = (which, v) => `<a:${which}Cxn id="${v.id}" idx="${v.idx}"/>`;
    const stTag = patch.start === undefined ? curSt : patch.start ? tag('st', patch.start) : '';
    const endTag = patch.end === undefined ? curEnd : patch.end ? tag('end', patch.end) : '';
    xml =
        xml.slice(0, m.index) +
            `<p:cNvCxnSpPr${m[1]}>${locks}${stTag}${endTag}${rest}</p:cNvCxnSpPr>` +
            xml.slice(m.index + m[0].length);
    el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false;
    el.dirtyPPr = undefined;
    el.anchor.originalXml = xml;
    const start = patch.start === undefined ? el.connection?.start : (patch.start ?? undefined);
    const end = patch.end === undefined ? el.connection?.end : (patch.end ?? undefined);
    el.connection =
        start || end ? { ...(start ? { start } : {}), ...(end ? { end } : {}) } : undefined;
    slide.structureDirty = true;
    return true;
}
// title/ctrTitle share one slot; content placeholders (body/obj/subTitle/untyped) match by idx
function phSlotKey(type, idx) {
    return type === 'title' || type === 'ctrTitle' ? 'title' : `body:${idx}`;
}
/**
 * Switch an existing slide's layout: point the slide rels' slideLayout
 * relationship at the new layout, then reparse (inheritance chain/decoration
 * layer/placeholder default styles all refreshed). Placeholder positions are kept
 * (existing shapes stay put; use resetSlideLayout to snap
 * them back). Layout placeholders with no counterpart on the slide are added as
 * empty prompt boxes (PowerPoint semantics).
 */
function setSlideLayout(opened, slideIndex, layoutPath) {
    const slide = opened.deck.slides[slideIndex];
    if (!slide)
        return null;
    if (!opened.archive.readText(layoutPath))
        return null;
    const relsPath = (0, zip_1.relsPathFor)(slide.path);
    const rels = opened.archive.readText(relsPath);
    if (!rels)
        return null;
    const relTarget = `../${layoutPath.slice('ppt/'.length)}`;
    const existing = new RegExp(`<Relationship\\b[^>]*Type="${LAYOUT_REL_TYPE}"[^>]*/>|<Relationship\\b[^>]*/>`, 'g');
    let next = null;
    for (const m of rels.matchAll(existing)) {
        if (!m[0].includes('slideLayout'))
            continue;
        next =
            rels.slice(0, m.index) +
                m[0].replace(/\bTarget="[^"]*"/, `Target="${(0, xml_utils_1.escapeXmlAttr)(relTarget)}"`) +
                rels.slice(m.index + m[0].length);
        break;
    }
    if (!next) {
        let maxRid = 0;
        for (const m of rels.matchAll(/Id="rId(\d+)"/g))
            maxRid = Math.max(maxRid, Number(m[1]));
        next = rels.replace('</Relationships>', `<Relationship Id="rId${maxRid + 1}" Type="${LAYOUT_REL_TYPE}" Target="${(0, xml_utils_1.escapeXmlAttr)(relTarget)}"/></Relationships>`);
    }
    opened.archive.entries.set(relsPath, Buffer.from(next, 'utf8'));
    const layoutPhs = (0, layout_1.parseLayoutPlaceholders)(opened.archive.readText(layoutPath) ?? '');
    const taken = new Set();
    let maxId = 1;
    for (const el of slide.elements) {
        const xml = patchedElementXml(el);
        const m = /<p:ph\b([^>]*?)\/?>/.exec(xml);
        const type = m ? (/\btype="([^"]*)"/.exec(m[1])?.[1] ?? '') : '';
        // ftr/sldNum/dt live outside the content-slot namespace (their idx 2/3/4 must not block body slots)
        if (m && !['ftr', 'sldNum', 'dt'].includes(type))
            taken.add(phSlotKey(type, /\bidx="([^"]*)"/.exec(m[1])?.[1] ?? ''));
        for (const idm of xml.matchAll(/<p:cNvPr\s[^>]*\bid="(\d+)"/g))
            maxId = Math.max(maxId, Number(idm[1]));
    }
    const missing = layoutPhs.filter((ph) => !taken.has(phSlotKey(ph.type, ph.idx)));
    if (missing.length) {
        const r = appendRawElements(opened, slideIndex, missing.map((ph, i) => (0, layout_1.placeholderSpXml)(ph, maxId + 1 + i)));
        if (r)
            return r.slide;
    }
    return materializeSlide(opened, slideIndex);
}
/**
 * Reset layout: placeholder elements drop their explicit <a:xfrm>, geometry falls
 * back to layout/master inheritance (restoring the inherited
 * position/size).
 */
function resetSlideLayout(opened, slideIndex) {
    const slide = opened.deck.slides[slideIndex];
    if (!slide)
        return null;
    let changed = false;
    for (const el of slide.elements) {
        if (!el.placeholder || (el.type !== 'text' && el.type !== 'shape'))
            continue;
        const xml = patchedElementXml(el);
        // spPr's xfrm is the first <a:xfrm> in the <p:sp> (txBody has no xfrm)
        const stripped = xml.replace(/<a:xfrm\b[^>]*>[\s\S]*?<\/a:xfrm>/, '');
        if (stripped === xml)
            continue;
        el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false;
        el.dirtyPPr = undefined;
        el.anchor.originalXml = stripped;
        changed = true;
    }
    if (!changed)
        return slide;
    slide.structureDirty = true;
    return materializeSlide(opened, slideIndex);
}
/**
 * Slide size (16:9 ↔ 4:3 etc.): edits <p:sldSz> in presentation.xml.
 * Content reflows with the canvas: each axis scales independently
 * (sx = cx/oldCx, sy = cy/oldCy), like PowerPoint's stretch on size change.
 * Anisotropic on purpose — it fills the new canvas with no letterbox bands
 * and makes A→B→A a true round-trip (within 1 EMU of rounding), which a
 * uniform fit-and-center scale cannot be. Font sizes are left alone.
 */
function setSlideSize(opened, cx, cy) {
    const { deck, archive } = opened;
    const old = deck.size;
    if (old.cx === cx && old.cy === cy)
        return false;
    const presPath = 'ppt/presentation.xml';
    const pres = archive.readText(presPath);
    if (!pres || !/<p:sldSz\b[^>]*\/?>/.test(pres))
        return false;
    const next = pres.replace(/<p:sldSz\b[^>]*?(\/?)>/, (tag) => tag.replace(/\bcx="\d+"/, `cx="${cx}"`).replace(/\bcy="\d+"/, `cy="${cy}"`));
    archive.entries.set(presPath, Buffer.from(next, 'utf8'));
    deck.size = { cx, cy };
    const sx = cx / old.cx;
    const sy = cy / old.cy;
    const scaleOffset = (o) => {
        o.x = Math.round(o.x * sx);
        o.y = Math.round(o.y * sy);
        o.cx = Math.round(o.cx * sx);
        o.cy = Math.round(o.cy * sy);
    };
    for (const slide of deck.slides) {
        for (const el of slide.elements) {
            const o = el.transform.offset;
            if (!o.cx && !o.cy)
                continue;
            scaleOffset(o);
            el.dirtyTransform = true;
        }
    }
    // layout/master scaled in sync (PowerPoint also rewrites masters on resize;
    // otherwise decorations/inherited placeholders still lay out at the old size).
    // A deliberate user action that is the exception to the never-write-masters rule.
    for (const part of (0, master_edit_1.listMasterParts)(archive)) {
        const partSlide = (0, master_edit_1.parseMasterPart)(archive, part.partPath);
        if (!partSlide)
            continue;
        let touched = false;
        for (const el of partSlide.elements) {
            const o = el.transform.offset;
            if (!o.cx && !o.cy)
                continue;
            scaleOffset(o);
            el.dirtyTransform = true;
            touched = true;
        }
        if (touched)
            archive.entries.set(part.partPath, Buffer.from(patchSlideXml(partSlide), 'utf8'));
    }
    deck.slides.forEach((_, i) => materializeSlide(opened, i));
    return true;
}
/** Append a batch of raw shape slices at the slide end and materialize; returns the new slide and new element ids (in append order). */
function appendRawElements(opened, slideIndex, xmls) {
    const slide = opened.deck.slides[slideIndex];
    if (!slide || !xmls.length)
        return null;
    const before = slide.elements.length;
    for (const xml of xmls) {
        slide.elements.push({
            id: `rawnew_${slide.elements.length}`,
            type: 'passthrough',
            kind: 'unknown',
            anchor: { spIndex: slide.elements.length, originalXml: xml, range: [0, 0] },
            transform: { offset: { x: 0, y: 0, cx: 0, cy: 0 }, rot: 0, flipH: false, flipV: false },
        });
    }
    slide.structureDirty = true;
    const fresh = materializeSlide(opened, slideIndex);
    if (!fresh)
        return null;
    return { slide: fresh, elementIds: fresh.elements.slice(before).map((e) => e.id) };
}
/** Insert a table: build a graphicFrame slice, append, and reparse. */
function addTable(opened, slideIndex, opts) {
    const slide = opened.deck.slides[slideIndex];
    if (!slide)
        return null;
    const r = appendRawElements(opened, slideIndex, [(0, insert_1.buildTableXml)(slide, opts)]);
    return r ? { slide: r.slide, elementId: r.elementIds[r.elementIds.length - 1] } : null;
}
// ── Table cell text editing ─────────────────────────────────────────────
/** Locate the nth <tag>…</tag> span in the xml (a:tr/a:tc never self-nest, so a sequential scan suffices). */
function nthTagSpan(xml, tag, n) {
    const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'g');
    let m;
    let i = 0;
    while ((m = openRe.exec(xml)) !== null) {
        const close = xml.indexOf(`</${tag}>`, openRe.lastIndex);
        if (close < 0)
            return null;
        const end = close + `</${tag}>`.length;
        if (i === n)
            return { start: m.index, end };
        i++;
        openRe.lastIndex = end;
    }
    return null;
}
/**
 * Rewrite table cell text: XML surgery (replacing the txBody paragraphs of the
 * col-th a:tc inside the row-th a:tr, keeping bodyPr/lstStyle/tcPr) with the model
 * synced. col is the tc index (not the logical column).
 */
function editTableCellText(slide, elementId, row, col, paragraphs) {
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el || el.type !== 'table')
        return false;
    const table = el;
    const cell = table.rows[row]?.[col];
    if (!cell || cell.merged)
        return false;
    const xml = el.anchor.originalXml;
    const tr = nthTagSpan(xml, 'a:tr', row);
    if (!tr)
        return false;
    const trXml = xml.slice(tr.start, tr.end);
    const tc = nthTagSpan(trXml, 'a:tc', col);
    if (!tc)
        return false;
    const tcXml = trXml.slice(tc.start, tc.end);
    const txOpen = /<a:txBody(\s[^>]*)?>/.exec(tcXml);
    const txEnd = tcXml.lastIndexOf('</a:txBody>');
    if (!txOpen || txEnd < 0)
        return false;
    const inner = tcXml.slice(txOpen.index + txOpen[0].length, txEnd);
    const bodyPr = /<a:bodyPr\b(?:[^>]*?)(?:\/>|>[\s\S]*?<\/a:bodyPr>)/.exec(inner)?.[0] ?? '<a:bodyPr/>';
    const lstStyle = /<a:lstStyle\b(?:[^>]*?)(?:\/>|>[\s\S]*?<\/a:lstStyle>)/.exec(inner)?.[0] ?? '';
    const paras = (paragraphs.length ? paragraphs : [{ runs: [{ text: '' }] }])
        .map((p) => (0, generate_1.generateParagraphXml)(p))
        .join('');
    const newTc = tcXml.slice(0, txOpen.index + txOpen[0].length) + bodyPr + lstStyle + paras + tcXml.slice(txEnd);
    const newTr = trXml.slice(0, tc.start) + newTc + trXml.slice(tc.end);
    el.anchor.originalXml = xml.slice(0, tr.start) + newTr + xml.slice(tr.end);
    // Model sync: keep anchor/insets (for render layout), replace paragraphs
    cell.text = {
        ...(cell.text ?? { insets: { l: 91440, r: 91440, t: 45720, b: 45720 } }),
        paragraphs,
    };
    slide.structureDirty = true;
    return true;
}
/**
 * Table style editing (surgical patch of a:tblPr + a:tcPr):
 * apply a preset style or change firstRow/bandRow/shading/borders without touching
 * cell text. anchor.originalXml is patched directly; structureDirty=true triggers
 * the save rebuild.
 */
function editTableStyle(slide, elementId, edit) {
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el || el.type !== 'table')
        return false;
    el.anchor.originalXml = (0, table_edit_1.patchTableStyleXml)(el.anchor.originalXml, edit);
    slide.structureDirty = true;
    return true;
}
/**
 * Ensure ppt/tableStyles.xml contains the given custom style (injected the first
 * time a preset is applied). Creates the part when missing, adding the
 * [Content_Types].xml Override and presentation rels.
 */
function ensureTableStylePart(opened, styleId, styleDefXml) {
    const { archive } = opened;
    const path = 'ppt/tableStyles.xml';
    const existing = archive.readText(path);
    const next = (0, table_edit_1.ensureTableStyleXml)(existing, styleId, styleDefXml);
    if (existing === next)
        return;
    archive.entries.set(path, Buffer.from(next, 'utf8'));
    if (existing)
        return;
    const ctPath = '[Content_Types].xml';
    const ct = archive.readText(ctPath);
    if (ct && !ct.includes(`PartName="/${path}"`)) {
        archive.entries.set(ctPath, Buffer.from(ct.replace('</Types>', `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/></Types>`), 'utf8'));
    }
    const presRelsPath = 'ppt/_rels/presentation.xml.rels';
    const presRels = archive.readText(presRelsPath);
    if (presRels && !presRels.includes('/relationships/tableStyles"')) {
        let maxRid = 0;
        for (const m of presRels.matchAll(/Id="rId(\d+)"/g))
            maxRid = Math.max(maxRid, Number(m[1]));
        const rel = `<Relationship Id="rId${maxRid + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>`;
        archive.entries.set(presRelsPath, Buffer.from(presRels.replace('</Relationships>', rel + '</Relationships>'), 'utf8'));
    }
}
/**
 * Chart editing (charts created by this app, rebuilding the chart part):
 * find the element's chart part path (via slide rels), rebuild the XML with the
 * new data/type/colors, and write it back to the archive. structureDirty=true
 * triggers a reparse.
 */
function editChartElement(opened, slideIndex, elementId, patch) {
    const slide = opened.deck.slides[slideIndex];
    if (!slide)
        return false;
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el || el.type !== 'chart')
        return false;
    const chartEl = el;
    if (chartEl.descr !== 'aislides-chart')
        return false; // only charts created by this app are editable
    // Find the chart part path (looked up from the slide rels)
    const { archive } = opened;
    const relsPath = (0, zip_1.relsPathFor)(slide.path);
    const rels = archive.readText(relsPath);
    if (!rels)
        return false;
    // Find the r:id in originalXml
    const rIdInFrame = /r:id="([^"]+)"/.exec(el.anchor.originalXml);
    if (!rIdInFrame)
        return false;
    const rId = rIdInFrame[1];
    // Find the chart part path in the rels
    const relRe = new RegExp(`Id="${escapeRegex(rId)}"[^>]*Target="([^"]+)"`);
    const relMatch = relRe.exec(rels);
    if (!relMatch)
        return false;
    const chartPath = (0, zip_1.resolveTarget)(slide.path, relMatch[1]);
    // Read existing chart data (used to fill unspecified fields)
    const existing = chartEl.chart;
    // Combo charts (bar+line) parse with main kind 'bar' and line series carrying plotKind='line':
    // when the type isn't explicitly changed, rebuild as comboBarLine so data/color-only edits
    // don't degrade combos into plain bar charts; likewise stacked bar → barStacked and pie with
    // a hole → doughnut, so style-only edits don't lose the type subvariant
    const isCombo = existing.kind === 'bar' && existing.series.some((s) => s.plotKind === 'line');
    const derivedKind = existing.kind === 'unknown'
        ? 'bar'
        : isCombo
            ? 'comboBarLine'
            : existing.kind === 'bar'
                ? existing.grouping === 'percentStacked'
                    ? 'barPercentStacked'
                    : existing.grouping === 'stacked'
                        ? 'barStacked'
                        : 'bar'
                : existing.kind === 'pie'
                    ? (existing.holePct ?? 0) > 0
                        ? 'doughnut'
                        : 'pie'
                    : existing.kind;
    const kind = patch.kind ?? derivedKind;
    // Horizontal bar direction is preserved through rebuilds; an explicit type change resets it unless the patch asks for barDir 'bar' (the gallery's horizontal-bar entry)
    const barDir = patch.barDir ??
        (patch.kind == null && existing.kind === 'bar' && existing.barDir === 'bar' && !isCombo
            ? 'bar'
            : undefined);
    let categories = patch.categories ?? existing.categories;
    let series = patch.series ??
        existing.series.map((s) => ({
            name: s.name ?? '',
            values: s.values.map((v) => v ?? 0),
        }));
    // Per-point colors survive every rebuild (parsed <c:dPt> back-fill), with patch overrides on top
    let pointColors = existing.series.map((s) => s.pointColors ? [...s.pointColors] : undefined);
    if (patch.pointColors) {
        for (const [si, pts] of Object.entries(patch.pointColors)) {
            const row = (pointColors[Number(si)] ??= []);
            for (const [pi, c] of Object.entries(pts))
                row[Number(pi)] = c ?? undefined;
        }
    }
    if (patch.switchRowCol) {
        const cats = categories;
        categories = series.map((s) => s.name);
        const transposed = cats.map((_, ci) => pointColors.some((row) => row?.[ci] != null)
            ? pointColors.map((row) => row?.[ci])
            : undefined);
        series = cats.map((cat, ci) => ({ name: cat, values: series.map((s) => s.values[ci] ?? 0) }));
        pointColors = transposed;
    }
    const title = patch.title ?? existing.title;
    // Style: fields not in the patch keep the values parsed from the existing part (rebuild loses no style)
    const legendPos = patch.legendPos ??
        (existing.legendPos == null ? 'none' : existing.legendPos === 'tr' ? 'r' : existing.legendPos);
    const dataLabels = patch.dataLabels ?? !!existing.dataLabels;
    const gridlines = patch.gridlines ?? !!existing.valAxis?.gridColor;
    const catAxisTitle = patch.catAxisTitle ?? existing.catAxis?.title;
    const valAxisTitle = patch.valAxisTitle ?? existing.valAxis?.title;
    const gapWidthPct = patch.gapWidthPct ?? existing.gapWidthPct;
    // Colors: when unspecified and every existing series has an explicit color, rebuild with those colors (type/data changes keep the palette)
    const existingColors = existing.series.map((s) => s.color);
    const colorScheme = patch.colorScheme ??
        (existingColors.every((c) => !!c) ? existingColors : undefined);
    const opts = {
        kind,
        ...(title !== undefined ? { title } : {}),
        categories,
        series,
        offset: { x: 0, y: 0, cx: 0, cy: 0 },
        legendPos,
        dataLabels,
        gridlines,
        ...(catAxisTitle ? { catAxisTitle } : {}),
        ...(valAxisTitle ? { valAxisTitle } : {}),
        ...(gapWidthPct != null ? { gapWidthPct } : {}),
        ...(barDir ? { barDir } : {}),
        ...(pointColors.some((row) => row?.some((c) => c != null)) ? { pointColors } : {}),
    };
    const newXml = buildChartSpaceXmlWithColors(opts, colorScheme);
    archive.entries.set(chartPath, Buffer.from(newXml, 'utf8'));
    slide.structureDirty = true;
    return true;
}
/**
 * Mark a chart not created by this app as editable (cNvPr descr="aislides-chart"):
 * only tags it without rewriting the chart part (the conversion itself is
 * lossless); subsequent edits go through editChartElement's rebuild template, and
 * fine-grained formatting beyond the parsed model (number formats/per-point
 * styles etc.) is dropped at that point.
 */
function markChartEditable(slide, elementId) {
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el || el.type !== 'chart')
        return false;
    const chartEl = el;
    if (chartEl.descr === 'aislides-chart')
        return true;
    const xml = el.anchor.originalXml;
    const m = /<p:cNvPr\b[^>]*\/?>/.exec(xml);
    if (!m)
        return false;
    const tag = m[0].includes('descr="')
        ? m[0].replace(/descr="[^"]*"/, 'descr="aislides-chart"')
        : m[0].replace(/(\/?>)$/, ' descr="aislides-chart"$1');
    el.anchor.originalXml = xml.slice(0, m.index) + tag + xml.slice(m.index + m[0].length);
    chartEl.descr = 'aislides-chart';
    slide.structureDirty = true;
    return true;
}
/** Chart XML build with colors (spPr solidFill on each series). */
function buildChartSpaceXmlWithColors(opts, colorScheme) {
    const base = (0, chart_insert_1.buildChartSpaceXml)(opts);
    if (!colorScheme || !colorScheme.length)
        return base;
    // The last series of a combo chart is the line: write the color as an <a:ln> stroke (lines use stroke color, bars/pies use fill color)
    const lineSerIdx = opts.kind === 'comboBarLine' && opts.series.length >= 2 ? opts.series.length - 1 : -1;
    let serIndex = 0;
    return base.replace(/<c:ser>/g, () => {
        const color = colorScheme[serIndex % colorScheme.length].replace('#', '').toUpperCase();
        const fill = `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
        const spPr = serIndex === lineSerIdx
            ? `<c:spPr><a:ln w="28575">${fill}</a:ln></c:spPr>`
            : `<c:spPr>${fill}</c:spPr>`;
        serIndex++;
        return `<c:ser>${spPr}`;
    });
}
/** Escape RegExp special characters. */
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Read a chart element's current data (for dialog echo-back). */
function getChartElementData(slide, elementId) {
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el || el.type !== 'chart')
        return null;
    const chartEl = el;
    return {
        kind: chartEl.chart.kind,
        title: chartEl.chart.title ?? '',
        categories: chartEl.chart.categories,
        series: chartEl.chart.series.map((s) => ({
            name: s.name ?? '',
            values: s.values.map((v) => v ?? 0),
        })),
        seriesColors: chartEl.chart.series.map((s) => s.color),
        pointColors: chartEl.chart.series.map((s) => (s.pointColors ? [...s.pointColors] : undefined)),
    };
}
function applyFontPatch(paragraphs, patch) {
    for (const p of paragraphs) {
        // Empty paragraph (e.g. a blank table cell): leave an empty marker run so the
        // format persists and text typed later inherits it
        if (!p.runs.length)
            p.runs.push({ text: '' });
        for (const r of p.runs) {
            if (patch.fontFamily !== undefined) {
                r.fontFamily = patch.fontFamily;
                // User explicitly changed the font: the original latin/ea keep-flags no longer apply, write the new font back
                delete r.latinFont;
                delete r.eaFont;
                delete r.fontImplicit;
            }
            if (patch.fontSizePt !== undefined) {
                r.fontSize = patch.fontSizePt;
                delete r.fontSizeImplicit;
            }
            if (patch.strike !== undefined) {
                r.strike = patch.strike;
                if (!patch.strike)
                    delete r.strikeStyle;
            }
            if (patch.bold !== undefined)
                r.bold = patch.bold;
            if (patch.italic !== undefined)
                r.italic = patch.italic;
            if (patch.underline !== undefined) {
                r.underline = patch.underline;
                if (!patch.underline)
                    delete r.underlineStyle;
            }
            if (patch.color !== undefined) {
                r.color = patch.color;
                delete r.colorFollowsTheme;
                delete r.colorInherited;
            }
        }
    }
}
function setElementFont(slide, elementId, patch) {
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el)
        return false;
    const apply = (paragraphs) => applyFontPatch(paragraphs, patch);
    if (el.type === 'text' || el.type === 'shape') {
        const t = el;
        if (!t.text?.paragraphs.length)
            return false;
        apply(t.text.paragraphs);
        el.dirty = true;
        return true;
    }
    if (el.type === 'table') {
        const table = el;
        let changed = false;
        for (let r = 0; r < table.rows.length; r++) {
            const row = table.rows[r];
            for (let c = 0; c < row.length; c++) {
                const cell = row[c];
                if (cell.merged || !cell.text?.paragraphs.length)
                    continue;
                apply(cell.text.paragraphs);
                if (editTableCellText(slide, elementId, r, c, cell.text.paragraphs))
                    changed = true;
            }
        }
        return changed;
    }
    return false;
}
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Deck-wide replace (matches within a run; cross-run matches are not handled —
 * consistent with byte-faithful run-structure patches). Covers text/shape, table
 * cells, and direct group children; dynamic field runs are skipped.
 * Returns the replacement count; elements on changed slides are flagged dirty.
 */
function replaceAllInDeck(deck, find, replace, opts = {}) {
    if (!find)
        return { count: 0, changedSlides: [] };
    const re = new RegExp(escapeRegExp(find), opts.matchCase ? 'g' : 'gi');
    let budget = opts.firstOnly ? 1 : Infinity;
    let count = 0;
    const changed = new Set();
    const replaceInParagraphs = (paragraphs) => {
        let hit = false;
        for (const p of paragraphs)
            for (const r of p.runs) {
                if (budget <= 0)
                    return hit;
                if (r.field || !r.text)
                    continue;
                re.lastIndex = 0;
                let n = 0;
                const next = r.text.replace(re, (m) => {
                    if (n >= budget)
                        return m;
                    n++;
                    return replace;
                });
                if (n > 0) {
                    r.text = next;
                    count += n;
                    budget -= n;
                    hit = true;
                }
            }
        return hit;
    };
    deck.slides.forEach((slide, si) => {
        if (budget <= 0)
            return;
        if (opts.slideIndex != null && si !== opts.slideIndex)
            return;
        for (const el of slide.elements) {
            if (budget <= 0)
                break;
            if (opts.elementId != null && el.id !== opts.elementId)
                continue;
            if ((el.type === 'text' || el.type === 'shape') && el.text) {
                if (replaceInParagraphs(el.text.paragraphs)) {
                    el.dirty = true;
                    changed.add(si);
                }
            }
            else if (el.type === 'table') {
                const table = el;
                for (let ri = 0; ri < table.rows.length; ri++) {
                    const row = table.rows[ri];
                    for (let ci = 0; ci < row.length; ci++) {
                        const cell = row[ci];
                        if (cell.merged || !cell.text?.paragraphs.length)
                            continue;
                        if (replaceInParagraphs(cell.text.paragraphs)) {
                            editTableCellText(slide, el.id, ri, ci, cell.text.paragraphs);
                            changed.add(si);
                        }
                        if (budget <= 0)
                            break;
                    }
                    if (budget <= 0)
                        break;
                }
            }
            else if (el.type === 'group') {
                for (const child of el.children) {
                    if (budget <= 0)
                        break;
                    if ((child.type === 'text' || child.type === 'shape') && child.text) {
                        if (replaceInParagraphs(child.text.paragraphs)) {
                            patchGroupChildText(slide, el.id, child);
                            changed.add(si);
                        }
                    }
                }
            }
        }
    });
    return { count, changedSlides: [...changed].sort((a, b) => a - b) };
}
/** PowerPoint default bullet hanging indent (0.25in = 228600 EMU) */
const BULLET_HANG_EMU = 228600;
function applyParagraphFormat(paragraphs, patch) {
    const dirty = {};
    for (const p of paragraphs) {
        // Missing pPrExplicit = newly created element (all-explicit semantics); change values only, don't build the flag table
        const mark = (k) => {
            if (p.pPrExplicit)
                p.pPrExplicit[k] = true;
        };
        if (patch.bullet) {
            if (patch.bullet === 'none') {
                p.bullet = { type: 'none' };
                // Removing the bullet also retracts the hanging indent
                p.marL = 0;
                p.indent = 0;
                mark('marL');
                mark('indent');
                dirty.indents = true;
            }
            else {
                // Keep the existing bullet's color/size/font when only the kind or glyph changes
                const prev = p.bullet && p.bullet.type !== 'none' ? p.bullet : undefined;
                const kept = {
                    ...(prev?.color ? { color: prev.color } : {}),
                    ...(prev?.sizePct != null ? { sizePct: prev.sizePct } : {}),
                    ...(prev?.font ? { font: prev.font } : {}),
                };
                p.bullet =
                    patch.bullet === 'number'
                        ? { type: 'number', numType: 'arabicPeriod', ...kept }
                        : { type: 'char', char: patch.bulletChar ?? '•', ...kept };
                // Add the default hanging indent when absent (stepped by level);
                // an explicit bulletHangEmu always re-applies
                const hang = patch.bulletHangEmu ?? BULLET_HANG_EMU;
                if (patch.bulletHangEmu != null || !(p.indent != null && p.indent < 0)) {
                    p.marL = hang * ((p.level ?? 0) + 1);
                    p.indent = -hang;
                    mark('marL');
                    mark('indent');
                    dirty.indents = true;
                }
            }
            mark('bullet');
            dirty.bullet = true;
        }
        else if (patch.bulletHangEmu != null) {
            // Standalone hang adjustment: only touches paragraphs that render a bullet
            const hasBullet = p.bullet && p.bullet.type !== 'none';
            if (hasBullet || (p.indent != null && p.indent < 0)) {
                p.marL = patch.bulletHangEmu * ((p.level ?? 0) + 1);
                p.indent = -patch.bulletHangEmu;
                mark('marL');
                mark('indent');
                dirty.indents = true;
            }
        }
        if (patch.bulletSizePct != null || patch.bulletColor) {
            // Standalone size/color adjustment: only touches paragraphs that render a bullet
            if (p.bullet && p.bullet.type !== 'none') {
                if (patch.bulletSizePct != null)
                    p.bullet.sizePct = patch.bulletSizePct;
                if (patch.bulletColor)
                    p.bullet.color = patch.bulletColor;
                mark('bullet');
                dirty.bullet = true;
            }
        }
        if (patch.lineSpacingPct != null) {
            p.lineHeight = patch.lineSpacingPct;
            delete p.lineExact;
            mark('lnSpc');
            dirty.lnSpc = true;
        }
        if (patch.spaceBeforePt != null) {
            p.spaceBefore = patch.spaceBeforePt;
            delete p.spaceBeforePct;
            mark('spcBef');
            dirty.spcBef = true;
        }
        if (patch.spaceAfterPt != null) {
            p.spaceAfter = patch.spaceAfterPt;
            delete p.spaceAfterPct;
            mark('spcAft');
            dirty.spcAft = true;
        }
        if (patch.align) {
            p.align = patch.align;
            mark('align');
            dirty.align = true;
        }
        if (patch.indentDelta) {
            const lvl = Math.max(0, Math.min(8, (p.level ?? 0) + patch.indentDelta));
            if (lvl !== (p.level ?? 0)) {
                p.level = lvl || undefined;
                dirty.level = true;
                // Own-bullet hanging indent steps with the level; inherited indents are left to the materialize reparse
                if (p.pPrExplicit?.marL && p.indent != null && p.indent < 0) {
                    p.marL = -p.indent * (lvl + 1);
                    dirty.indents = true;
                }
            }
        }
    }
    return dirty;
}
/** Merge PPrDirty (multiple operations accumulate on the element). */
function mergePPrDirty(el, d) {
    if (!Object.keys(d).length)
        return;
    // paraIndices: only stays restricted while every accumulated op was restricted
    const indices = el.dirtyPPr == null
        ? d.paraIndices
        : el.dirtyPPr.paraIndices && d.paraIndices
            ? [...new Set([...el.dirtyPPr.paraIndices, ...d.paraIndices])]
            : undefined;
    el.dirtyPPr = { ...el.dirtyPPr, ...d };
    if (indices)
        el.dirtyPPr.paraIndices = indices;
    else
        delete el.dirtyPPr.paraIndices;
}
/**
 * Change paragraph formatting directly on a selected element (bullet/line
 * spacing/paragraph spacing/alignment), applied to all of its paragraphs
 * (text/shape/table; same as clicking bullets with a shape selected in PowerPoint).
 * paraIndices restricts the patch to those paragraphs (editing-mode selection).
 */
function setElementParagraphFormat(slide, elementId, patch, paraIndices) {
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el)
        return false;
    if (el.type === 'text' || el.type === 'shape') {
        const t = el;
        if (!t.text?.paragraphs.length)
            return false;
        const target = paraIndices
            ? paraIndices.map((i) => t.text.paragraphs[i]).filter((p) => !!p)
            : t.text.paragraphs;
        if (!target.length)
            return false;
        const dirty = applyParagraphFormat(target, patch);
        if (paraIndices && Object.keys(dirty).length)
            dirty.paraIndices = paraIndices;
        mergePPrDirty(el, dirty);
        return !!el.dirtyPPr;
    }
    if (el.type === 'table') {
        const table = el;
        let changed = false;
        for (let r = 0; r < table.rows.length; r++) {
            const row = table.rows[r];
            for (let c = 0; c < row.length; c++) {
                const cell = row[c];
                if (cell.merged || !cell.text?.paragraphs.length)
                    continue;
                applyParagraphFormat(cell.text.paragraphs, patch);
                if (editTableCellText(slide, elementId, r, c, cell.text.paragraphs))
                    changed = true;
            }
        }
        return changed;
    }
    return false;
}
/** Paragraph formatting for a group child (same semantics as setGroupChildFont; the pPr patch is baked straight into the group bytes). */
function setGroupChildParagraphFormat(slide, groupId, childId, patch, paraIndices) {
    const found = findGroupChild(slide, groupId, childId);
    const child = found?.child;
    if (!child || (child.type !== 'text' && child.type !== 'shape'))
        return false;
    const t = child;
    if (!t.text?.paragraphs.length)
        return false;
    const target = paraIndices
        ? paraIndices.map((i) => t.text.paragraphs[i]).filter((p) => !!p)
        : t.text.paragraphs;
    if (!target.length)
        return false;
    const dirty = applyParagraphFormat(target, patch);
    if (!Object.keys(dirty).length)
        return false;
    if (paraIndices)
        dirty.paraIndices = paraIndices;
    if (!patchGroupChildXml(found.grp, t, (xml) => (0, generate_1.patchElementPPr)(t, xml, dirty) ?? (0, generate_1.rebuildTxBody)(t, xml))) {
        return false;
    }
    slide.structureDirty = true;
    return true;
}
/** Row/column surgery is unsafe when the table has merged cells (gridSpan/rowSpan/hMerge/vMerge); refuse. */
function tableHasMerges(xml) {
    return /\b(?:gridSpan|rowSpan|hMerge|vMerge)="/.test(xml);
}
/** Clear the text of every tc in a table XML fragment (keeping tcPr formatting), used when cloning a reference row/column. */
function clearTcText(xml) {
    return xml.replace(/<a:txBody(\s[^>]*)?>[\s\S]*?<\/a:txBody>/g, '<a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody>');
}
/** Adjust one dimension of the graphicFrame <p:xfrm><a:ext> (cx/cy delta, EMU). */
function bumpFrameExt(xml, attr, delta) {
    const m = /<p:xfrm[^>]*>[\s\S]*?<a:ext\s[^>]*\/>/.exec(xml);
    if (!m)
        return xml;
    const patched = m[0].replace(new RegExp(`\\b${attr}="(-?\\d+)"`), (_a, v) => `${attr}="${Math.max(1, Number(v) + delta)}"`);
    return xml.slice(0, m.index) + patched + xml.slice(m.index + m[0].length);
}
/**
 * Table row/column insert/delete (XML surgery + materialize/reparse):
 * - Inserted rows/columns clone the reference row/column's formatting with text
 *   cleared; the table frame grows/shrinks with the total row height/column width.
 * - Deleting is refused when only 1 row/column remains; tables with merged cells
 *   are always refused.
 * After reparse element ids change; the new table id is found back by element position.
 */
function editTableStructure(opened, slideIndex, elementId, op) {
    const slide = opened.deck.slides[slideIndex];
    if (!slide)
        return null;
    const elIndex = slide.elements.findIndex((e) => e.id === elementId);
    const el = slide.elements[elIndex];
    if (!el || el.type !== 'table')
        return null;
    // Bake the element's unsaved patches into the slice first; the surgery works on the latest bytes
    let xml = patchedElementXml(el);
    if (tableHasMerges(xml))
        return null;
    const trSpans = [];
    for (let i = 0;; i++) {
        const span = nthTagSpan(xml, 'a:tr', i);
        if (!span)
            break;
        trSpans.push(span);
    }
    const nRows = trSpans.length;
    const gridColRe = /<a:gridCol\s[^>]*\/>/g;
    const gridCols = [...xml.matchAll(gridColRe)];
    const nCols = gridCols.length;
    if (!nRows || !nCols)
        return null;
    if (op.kind === 'insert-row' || op.kind === 'delete-row') {
        const at = op.index;
        const ref = trSpans[at];
        if (!ref)
            return null;
        const refXml = xml.slice(ref.start, ref.end);
        const rowH = Number(/<a:tr\s[^>]*\bh="(\d+)"/.exec(refXml)?.[1] ?? 0);
        if (op.kind === 'insert-row') {
            const clone = clearTcText(refXml);
            const insertAt = op.before ? ref.start : ref.end;
            xml = xml.slice(0, insertAt) + clone + xml.slice(insertAt);
            xml = bumpFrameExt(xml, 'cy', rowH);
        }
        else {
            if (nRows <= 1)
                return null;
            xml = xml.slice(0, ref.start) + xml.slice(ref.end);
            xml = bumpFrameExt(xml, 'cy', -rowH);
        }
    }
    else {
        const at = op.index;
        const refCol = gridCols[at];
        if (!refCol)
            return null;
        const colW = Number(/\bw="(\d+)"/.exec(refCol[0])?.[1] ?? 0);
        if (op.kind === 'delete-col' && nCols <= 1)
            return null;
        // Process tc row by row (replace back-to-front so offsets stay valid)
        for (let r = nRows - 1; r >= 0; r--) {
            const tr = nthTagSpan(xml, 'a:tr', r);
            if (!tr)
                return null;
            const trXml = xml.slice(tr.start, tr.end);
            const tc = nthTagSpan(trXml, 'a:tc', at);
            if (!tc)
                return null;
            let newTr;
            if (op.kind === 'insert-col') {
                const clone = clearTcText(trXml.slice(tc.start, tc.end));
                const insertAt = op.before ? tc.start : tc.end;
                newTr = trXml.slice(0, insertAt) + clone + trXml.slice(insertAt);
            }
            else {
                newTr = trXml.slice(0, tc.start) + trXml.slice(tc.end);
            }
            xml = xml.slice(0, tr.start) + newTr + xml.slice(tr.end);
        }
        // gridCol and frame width
        const gc = [...xml.matchAll(gridColRe)][at];
        if (op.kind === 'insert-col') {
            const insertAt = op.before ? gc.index : gc.index + gc[0].length;
            xml = xml.slice(0, insertAt) + gc[0] + xml.slice(insertAt);
            xml = bumpFrameExt(xml, 'cx', colW);
        }
        else {
            xml = xml.slice(0, gc.index) + xml.slice(gc.index + gc[0].length);
            xml = bumpFrameExt(xml, 'cx', -colW);
        }
    }
    el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false;
    el.dirtyPPr = undefined;
    el.anchor.originalXml = xml;
    slide.structureDirty = true;
    const fresh = materializeSlide(opened, slideIndex);
    if (!fresh)
        return null;
    const newEl = fresh.elements[elIndex];
    if (!newEl)
        return null;
    return { slide: fresh, elementId: newEl.id };
}
const tcAttr = (tcOpen, name) => {
    const m = new RegExp(`\\b${name}="(\\d+)"`).exec(tcOpen);
    return m ? Number(m[1]) : 0;
};
/** Change an <a:tc> open-tag attribute: val=null removes it, otherwise sets it. Returns the whole tc XML. */
function setTcAttrXml(tcXml, name, val) {
    return tcXml.replace(/<a:tc(\s[^>]*)?>/, (open) => {
        const cleaned = open.replace(new RegExp(`\\s${name}="[^"]*"`), '');
        if (val == null)
            return cleaned;
        return cleaned.replace(/^<a:tc/, `<a:tc ${name}="${val}"`);
    });
}
/** Extract non-empty paragraphs from a tc (merging folds the absorbed cell's content into the anchor cell). */
function tcParagraphsXml(tcXml) {
    const body = /<a:txBody(?:\s[^>]*)?>([\s\S]*?)<\/a:txBody>/.exec(tcXml)?.[1] ?? '';
    const paras = body.match(/<a:p>[\s\S]*?<\/a:p>|<a:p\/>/g) ?? [];
    return paras.filter((p) => /<a:t>(?=[^<]*\S)[^<]*<\/a:t>/.test(p)).join('');
}
/**
 * Merge/split cells (XML surgery + materialize/reparse). v1 constraints:
 * merge-right requires anchor rowSpan=1 and a plain right neighbor; merge-down
 * requires anchor gridSpan=1 and a plain neighbor below (an already-merged anchor
 * can keep extending). The absorbed cell's text folds into the anchor.
 */
function mergeTableCells(opened, slideIndex, elementId, op) {
    const slide = opened.deck.slides[slideIndex];
    if (!slide)
        return null;
    const elIndex = slide.elements.findIndex((e) => e.id === elementId);
    const el = slide.elements[elIndex];
    if (!el || el.type !== 'table')
        return null;
    let xml = patchedElementXml(el);
    const tr = nthTagSpan(xml, 'a:tr', op.row);
    if (!tr)
        return null;
    let trXml = xml.slice(tr.start, tr.end);
    const anchorSpan = nthTagSpan(trXml, 'a:tc', op.col);
    if (!anchorSpan)
        return null;
    let anchorXml = trXml.slice(anchorSpan.start, anchorSpan.end);
    const anchorOpen = /<a:tc(\s[^>]*)?>/.exec(anchorXml)[0];
    if (/\b[hv]Merge="/.test(anchorOpen))
        return null;
    const g = tcAttr(anchorOpen, 'gridSpan') || 1;
    const v = tcAttr(anchorOpen, 'rowSpan') || 1;
    const isPlainTc = (tcXml) => !/\b(?:gridSpan|rowSpan|hMerge|vMerge)="/.test(/<a:tc(\s[^>]*)?>/.exec(tcXml)[0]);
    /** Clear text + set the merge continuation flag. */
    const toCovered = (tcXml, mark) => setTcAttrXml(clearTcText(tcXml), mark, 1);
    const appendToAnchor = (parasXml) => {
        if (parasXml)
            anchorXml = anchorXml.replace(/<\/a:txBody>/, `${parasXml}</a:txBody>`);
    };
    if (op.kind === 'merge-right') {
        if (v !== 1)
            return null;
        const target = nthTagSpan(trXml, 'a:tc', op.col + g);
        if (!target)
            return null;
        const targetXml = trXml.slice(target.start, target.end);
        if (!isPlainTc(targetXml))
            return null;
        appendToAnchor(tcParagraphsXml(targetXml));
        anchorXml = setTcAttrXml(anchorXml, 'gridSpan', g + 1);
        trXml =
            trXml.slice(0, anchorSpan.start) +
                anchorXml +
                trXml.slice(anchorSpan.end, target.start) +
                toCovered(targetXml, 'hMerge') +
                trXml.slice(target.end);
        xml = xml.slice(0, tr.start) + trXml + xml.slice(tr.end);
    }
    else if (op.kind === 'merge-down') {
        if (g !== 1)
            return null;
        const tr2 = nthTagSpan(xml, 'a:tr', op.row + v);
        if (!tr2)
            return null;
        let tr2Xml = xml.slice(tr2.start, tr2.end);
        const target = nthTagSpan(tr2Xml, 'a:tc', op.col);
        if (!target)
            return null;
        const targetXml = tr2Xml.slice(target.start, target.end);
        if (!isPlainTc(targetXml))
            return null;
        appendToAnchor(tcParagraphsXml(targetXml));
        anchorXml = setTcAttrXml(anchorXml, 'rowSpan', v + 1);
        trXml = trXml.slice(0, anchorSpan.start) + anchorXml + trXml.slice(anchorSpan.end);
        tr2Xml =
            tr2Xml.slice(0, target.start) + toCovered(targetXml, 'vMerge') + tr2Xml.slice(target.end);
        // The later row goes first so the earlier offsets stay valid
        xml = xml.slice(0, tr2.start) + tr2Xml + xml.slice(tr2.end);
        xml = xml.slice(0, tr.start) + trXml + xml.slice(tr.end);
    }
    else {
        if (g <= 1 && v <= 1)
            return null;
        // Process rows back-to-front so offsets stay valid
        for (let r = op.row + v - 1; r >= op.row; r--) {
            const rowSpanRef = nthTagSpan(xml, 'a:tr', r);
            if (!rowSpanRef)
                return null;
            let rowXml = xml.slice(rowSpanRef.start, rowSpanRef.end);
            for (let c = op.col + g - 1; c >= op.col; c--) {
                const span = nthTagSpan(rowXml, 'a:tc', c);
                if (!span)
                    return null;
                let tcXml = rowXml.slice(span.start, span.end);
                if (r === op.row && c === op.col) {
                    tcXml = setTcAttrXml(setTcAttrXml(tcXml, 'gridSpan', null), 'rowSpan', null);
                }
                else {
                    tcXml = setTcAttrXml(setTcAttrXml(tcXml, 'hMerge', null), 'vMerge', null);
                }
                rowXml = rowXml.slice(0, span.start) + tcXml + rowXml.slice(span.end);
            }
            xml = xml.slice(0, rowSpanRef.start) + rowXml + xml.slice(rowSpanRef.end);
        }
    }
    el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false;
    el.dirtyPPr = undefined;
    el.anchor.originalXml = xml;
    slide.structureDirty = true;
    const fresh = materializeSlide(opened, slideIndex);
    if (!fresh)
        return null;
    const newEl = fresh.elements[elIndex];
    if (!newEl)
        return null;
    return { slide: fresh, elementId: newEl.id };
}
/**
 * Set a column's width (EMU): gridCol w + frame ext.cx synced, model updated in
 * place (no reparse, element ids stable — good for drag resizing).
 */
function setTableColWidth(slide, elementId, col, wEmu) {
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el || el.type !== 'table')
        return false;
    const table = el;
    if (col < 0 || col >= table.colWidths.length)
        return false;
    let xml = patchedElementXml(el);
    const gc = [...xml.matchAll(/<a:gridCol\s[^>]*\/>/g)][col];
    if (!gc)
        return false;
    el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false;
    el.dirtyPPr = undefined;
    const w = Math.max(1, Math.round(wEmu));
    const patched = gc[0].replace(/\bw="-?\d+"/, `w="${w}"`);
    xml = xml.slice(0, gc.index) + patched + xml.slice(gc.index + gc[0].length);
    table.colWidths[col] = w;
    const sum = table.colWidths.reduce((a, b) => a + b, 0);
    xml = xml.replace(/(<p:xfrm[^>]*>[\s\S]*?<a:ext\s[^>]*\bcx=")-?\d+(")/, (_a, pre, post) => `${pre}${sum}${post}`);
    el.anchor.originalXml = xml;
    el.transform.offset.cx = sum;
    slide.structureDirty = true;
    return true;
}
/** Set a row's height (EMU): <a:tr h> + frame ext.cy synced (matching setTableColWidth semantics). */
function setTableRowHeight(slide, elementId, row, hEmu) {
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el || el.type !== 'table')
        return false;
    const table = el;
    if (row < 0 || row >= table.rowHeights.length)
        return false;
    let xml = patchedElementXml(el);
    const tr = nthTagSpan(xml, 'a:tr', row);
    if (!tr)
        return false;
    el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false;
    el.dirtyPPr = undefined;
    const h = Math.max(1, Math.round(hEmu));
    const trOpen = /<a:tr(\s[^>]*)?>/.exec(xml.slice(tr.start, tr.end))[0];
    const patchedOpen = /\bh="-?\d+"/.test(trOpen)
        ? trOpen.replace(/\bh="-?\d+"/, `h="${h}"`)
        : trOpen.replace(/^<a:tr/, `<a:tr h="${h}"`);
    xml = xml.slice(0, tr.start) + patchedOpen + xml.slice(tr.start + trOpen.length);
    table.rowHeights[row] = h;
    const sum = table.rowHeights.reduce((a, b) => a + b, 0);
    xml = xml.replace(/(<p:xfrm[^>]*>[\s\S]*?<a:ext\s[^>]*\bcy=")-?\d+(")/, (_a, pre, post) => `${pre}${sum}${post}`);
    el.anchor.originalXml = xml;
    el.transform.offset.cy = sum;
    slide.structureDirty = true;
    return true;
}
/** Scale values so they sum exactly to target (>=1 each; the last entry absorbs rounding drift). */
function scaleToSum(values, target) {
    const sum = values.reduce((a, b) => a + b, 0);
    if (sum <= 0)
        return values;
    const out = values.map((v) => Math.max(1, Math.round((v * target) / sum)));
    const drift = target - out.reduce((a, b) => a + b, 0);
    out[out.length - 1] = Math.max(1, out[out.length - 1] + drift);
    return out;
}
/**
 * Resize a table by proportionally redistributing <a:gridCol w> and <a:tr h>
 * (PowerPoint's behavior). Without this, setting the frame's a:ext leaves the
 * internal grid at its old size, so other software renders the old dimensions
 *. The frame ext is synced to the redistributed sums.
 */
function resizeTable(slide, elementId, cx, cy) {
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el || el.type !== 'table')
        return false;
    const table = el;
    if (!table.colWidths.length || !table.rowHeights.length)
        return false;
    const targetCx = Math.max(table.colWidths.length, Math.round(cx));
    const targetCy = Math.max(table.rowHeights.length, Math.round(cy));
    let xml = patchedElementXml(el);
    el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false;
    el.dirtyPPr = undefined;
    const widths = scaleToSum(table.colWidths, targetCx);
    let ci = 0;
    xml = xml.replace(/<a:gridCol\s[^>]*\/>/g, (m) => ci < widths.length ? m.replace(/\bw="-?\d+"/, `w="${widths[ci++]}"`) : m);
    const heights = scaleToSum(table.rowHeights, targetCy);
    let ri = 0;
    xml = xml.replace(/<a:tr(\s[^>]*)?>/g, (m) => {
        if (ri >= heights.length)
            return m;
        const h = heights[ri++];
        return /\bh="-?\d+"/.test(m)
            ? m.replace(/\bh="-?\d+"/, `h="${h}"`)
            : m.replace(/^<a:tr/, `<a:tr h="${h}"`);
    });
    const sumW = widths.reduce((a, b) => a + b, 0);
    const sumH = heights.reduce((a, b) => a + b, 0);
    xml = xml.replace(/(<p:xfrm[^>]*>[\s\S]*?<a:ext\s[^>]*\bcx=")-?\d+(")/, (_a, pre, post) => `${pre}${sumW}${post}`);
    xml = xml.replace(/(<p:xfrm[^>]*>[\s\S]*?<a:ext\s[^>]*\bcy=")-?\d+(")/, (_a, pre, post) => `${pre}${sumH}${post}`);
    table.colWidths = widths;
    table.rowHeights = heights;
    el.anchor.originalXml = xml;
    el.transform.offset.cx = sumW;
    el.transform.offset.cy = sumH;
    slide.structureDirty = true;
    return true;
}
/** Cell text vertical alignment (tcPr anchor: t/ctr/b). Byte surgery + model sync. */
function setTableCellAnchor(slide, elementId, row, col, anchor) {
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el || el.type !== 'table')
        return false;
    const table = el;
    const cell = table.rows[row]?.[col];
    if (!cell || cell.merged)
        return false;
    let xml = patchedElementXml(el);
    const tr = nthTagSpan(xml, 'a:tr', row);
    if (!tr)
        return false;
    let trXml = xml.slice(tr.start, tr.end);
    const tc = nthTagSpan(trXml, 'a:tc', col);
    if (!tc)
        return false;
    let tcXml = trXml.slice(tc.start, tc.end);
    const val = anchor === 'middle' ? 'ctr' : anchor === 'bottom' ? 'b' : 't';
    const tcPr = /<a:tcPr(\s[^>]*)?\/?>/.exec(tcXml);
    if (tcPr) {
        let tag = tcPr[0].replace(/\s+anchor="[^"]*"/, '');
        tag = tag.replace(/^<a:tcPr/, `<a:tcPr anchor="${val}"`);
        tcXml = tcXml.slice(0, tcPr.index) + tag + tcXml.slice(tcPr.index + tcPr[0].length);
    }
    else {
        tcXml = tcXml.replace(/<\/a:tc>$/, `<a:tcPr anchor="${val}"/></a:tc>`);
    }
    trXml = trXml.slice(0, tc.start) + tcXml + trXml.slice(tc.end);
    xml = xml.slice(0, tr.start) + trXml + xml.slice(tr.end);
    el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false;
    el.dirtyPPr = undefined;
    el.anchor.originalXml = xml;
    if (cell.text)
        cell.text.anchor = anchor;
    slide.structureDirty = true;
    return true;
}
const RID_ATTR_RE = /\br:(?:embed|link|id)="(rId\d+)"/g;
/** Copy: grab the element's current XML and the relationships it references (part paths that pictures/charts etc. point at). */
function copyElementData(opened, slide, el) {
    const xml = patchedElementXml(el);
    const slideRels = opened.archive.readRels(slide.path);
    const rels = [];
    const seen = new Set();
    for (const m of xml.matchAll(RID_ATTR_RE)) {
        const rid = m[1];
        if (seen.has(rid))
            continue;
        seen.add(rid);
        const rel = slideRels.get(rid);
        if (!rel)
            continue;
        const external = rel.targetMode === 'External';
        rels.push({
            rid,
            type: rel.type,
            target: external ? rel.target : (0, zip_1.resolveTarget)(slide.path, rel.target),
            ...(external ? { external: true } : {}),
        });
    }
    return { xml, rels };
}
/** 'ppt/media/image1.png' → the relative Target '../media/image1.png' in the slide rels */
function relTargetFromSlide(absTarget) {
    return absTarget.startsWith('ppt/') ? `../${absTarget.slice(4)}` : `/${absTarget}`;
}
/**
 * Paste: rels surgery (reuse the rId when the target slide already has a
 * relationship with the same type+target, otherwise create one pointing at the
 * same part — media bytes are not copied), renumber cNvPr ids, offset the whole
 * thing, append, and reparse.
 */
function pasteElements(opened, slideIndex, items, shiftEmu) {
    const { archive, deck } = opened;
    const slide = deck.slides[slideIndex];
    if (!slide || !items.length)
        return null;
    const relsPath = (0, zip_1.relsPathFor)(slide.path);
    let relsXml = archive.readText(relsPath) ??
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    let relsDirty = false;
    let maxRid = 0;
    for (const m of relsXml.matchAll(/Id="rId(\d+)"/g))
        maxRid = Math.max(maxRid, Number(m[1]));
    // The target slide's existing relationships (type+resolved target → rId); ones created during the paste count too
    const byKey = new Map();
    for (const rel of archive.readRels(slide.path).values()) {
        const abs = rel.targetMode === 'External' ? rel.target : (0, zip_1.resolveTarget)(slide.path, rel.target);
        byKey.set(`${rel.type} ${abs}`, rel.id);
    }
    let nextId = (0, insert_1.nextCNvPrId)(slide);
    const xmls = items.map((item) => {
        let xml = item.xml;
        for (const rel of item.rels) {
            const key = `${rel.type} ${rel.target}`;
            let rid = byKey.get(key);
            if (!rid) {
                rid = `rId${++maxRid}`;
                const target = rel.external ? rel.target : relTargetFromSlide(rel.target);
                const mode = rel.external ? ' TargetMode="External"' : '';
                relsXml = relsXml.replace('</Relationships>', `<Relationship Id="${rid}" Type="${rel.type}" Target="${(0, xml_utils_1.escapeXmlAttr)(target)}"${mode}/></Relationships>`);
                relsDirty = true;
                byKey.set(key, rid);
            }
            if (rid !== rel.rid) {
                xml = xml.replace(new RegExp(`\\br:(embed|link|id)="${rel.rid}"`, 'g'), `r:$1="${rid}"`);
            }
        }
        xml = xml.replace(/(<p:cNvPr\s[^>]*\bid=")\d+(")/g, (_a, pre, post) => `${pre}${nextId++}${post}`);
        // Offset only the outermost xfrm's off (group child coordinate systems stay put)
        xml = xml.replace(/<a:off\b[^>]*\/>/, (tag) => tag
            .replace(/\bx="(-?\d+)"/, (_m, v) => `x="${Number(v) + shiftEmu.dx}"`)
            .replace(/\by="(-?\d+)"/, (_m, v) => `y="${Number(v) + shiftEmu.dy}"`));
        return xml;
    });
    if (relsDirty)
        archive.entries.set(relsPath, Buffer.from(relsXml, 'utf8'));
    return appendRawElements(opened, slideIndex, xmls);
}
// ── Slide transitions ───────────────────────────────────────────────────
/** Set/clear the transition (writes bodySuffix, persisted with the whole-slide rebuild on save). */
function setSlideTransition(slide, kind) {
    slide.bodySuffix = (0, generate_1.patchSlideTransitionXml)(slide.bodySuffix, kind);
    slide.structureDirty = true;
}
/** Read the current transition. */
function getSlideTransition(slide) {
    return (0, generate_1.readSlideTransitionXml)(slide.bodySuffix);
}
/** Set/clear the auto-advance time (advTm, ms; saved by rehearsal timing, auto-advances in PowerPoint slideshows). */
function setSlideAdvanceTime(slide, ms) {
    slide.bodySuffix = (0, generate_1.patchSlideAdvanceTimeXml)(slide.bodySuffix, ms);
    slide.structureDirty = true;
}
/** Read the auto-advance time (ms; null when unset). */
function getSlideAdvanceTime(slide) {
    return (0, generate_1.readSlideAdvanceTimeXml)(slide.bodySuffix);
}
// ── Hidden slides ───────────────────────────────────────────────────────
/** Hide/unhide a slide (<p:sld show="0">, skipped in PowerPoint slideshows). */
function setSlideHidden(slide, hidden) {
    slide.bodyPrefix = (0, generate_1.patchSlideHiddenXml)(slide.bodyPrefix, hidden);
    slide.structureDirty = true;
}
/** Read whether the slide is hidden. */
function getSlideHidden(slide) {
    return (0, generate_1.readSlideHiddenXml)(slide.bodyPrefix);
}
/**
 * Fetch a slide's patch-rebuilt result directly (Phase 1: with no dirty elements
 * it should equal originalXml). Lets tests verify the scan's
 * prefix/elements/suffix concatenation is lossless.
 */
function reassembleSlideXml(slide) {
    const parts = [slide.bodyPrefix];
    for (const el of slide.elements) {
        parts.push(el.anchor.originalXml);
        if (el.anchor.gapAfter)
            parts.push(el.anchor.gapAfter);
    }
    parts.push(slide.bodySuffix);
    return parts.join('');
}
// ── Element group / ungroup ───────────────────────────────────────────────
/**
 * Group multiple editable elements (text/shape/picture) into one p:grpSp.
 *
 * - Removes the selected elements from slide.elements, builds the p:grpSp XML and appends at the slide end
 * - Goes through the appendRawElements → materialize path (structureDirty=true, rebuilt on save)
 * - Only accepts text/shape/picture; passthrough/table/chart/group are refused outright
 * - Requires at least 2 elements
 *
 * Returns: { slide: fresh Slide, groupId: new group element id } or null (failure)
 */
function groupElements(opened, slideIndex, sourceIds) {
    const slide = opened.deck.slides[slideIndex];
    if (!slide || sourceIds.length < 2)
        return null;
    // Validate: only text/shape/picture allowed
    const GROUPABLE = new Set(['text', 'shape', 'picture']);
    const targets = sourceIds
        .map((id) => slide.elements.find((e) => e.id === id))
        .filter(Boolean);
    if (targets.length < 2)
        return null;
    if (targets.some((e) => !GROUPABLE.has(e.type)))
        return null;
    // Compute the bounding box
    const bbox = (0, insert_1.calcBoundingBox)(targets);
    // Child XML: keep original bytes (patchedElementXml equals originalXml when clean)
    const childrenXml = targets.map((e) => patchedElementXml(e)).join('');
    // Build the grpSp XML
    const grpXml = (0, insert_1.buildGrpSpXml)(slide, bbox, childrenXml);
    // Remove the selected elements from the current slide
    const idSet = new Set(sourceIds);
    slide.elements = slide.elements.filter((e) => !idSet.has(e.id));
    // Append the grpSp and reparse
    const result = appendRawElements(opened, slideIndex, [grpXml]);
    if (!result)
        return null;
    return { slide: result.slide, groupId: result.elementIds[result.elementIds.length - 1] };
}
/**
 * Ungroup: lift the group's children to the slide top level.
 *
 * Coordinate conversion rules:
 * - If childOffset defines a child coordinate system (chOff/chExt), child
 *   coordinates are based on it.
 * - This implementation sets chOff=off, chExt=ext (1:1 mapping) in buildGrpSpXml,
 *   so child coordinates are directly slide coordinates; groups from old files
 *   get the generic conversion too.
 * - Conversion: slideX = childX - chOff.x + group.off.x (plus * ext/chExt when scaled)
 *
 * Old-file groups pass their bytes through wholesale; after ungrouping they take
 * the rebuild path (structureDirty=true). Passthrough children (charts etc.)
 * keep their originalXml slices.
 *
 * Returns a fresh Slide or null.
 */
function ungroupElement(opened, slideIndex, sourceId) {
    const slide = opened.deck.slides[slideIndex];
    if (!slide)
        return null;
    const groupEl = slide.elements.find((e) => e.id === sourceId);
    if (!groupEl || groupEl.type !== 'group')
        return null;
    const grp = groupEl;
    // Coordinate conversion parameters
    const gOff = grp.transform.offset; // group's position on the slide
    const chOff = grp.childOffset ?? { x: 0, y: 0, cx: gOff.cx, cy: gOff.cy };
    // Scale factors (ext/chExt; groups built by this app are 1:1)
    const scaleX = chOff.cx > 0 ? gOff.cx / chOff.cx : 1;
    const scaleY = chOff.cy > 0 ? gOff.cy / chOff.cy : 1;
    // Direct child fragments in document order — same order as grp.children (parseGroup
    // sorts by source offset), so index i on both sides refers to the same child
    const childXmls = (0, parse_1.sliceGroupChildXmls)(grp.anchor.originalXml);
    // Convert each child's coordinates into the slide coordinate system
    const liftedXmls = [];
    for (let i = 0; i < childXmls.length; i++) {
        const childXml = childXmls[i];
        const child = grp.children[i];
        if (!child) {
            // No corresponding model (e.g. an unparsed child), keep as-is
            liftedXmls.push(childXml);
            continue;
        }
        const co = child.transform.offset;
        const slideX = Math.round((co.x - chOff.x) * scaleX + gOff.x);
        const slideY = Math.round((co.y - chOff.y) * scaleY + gOff.y);
        const slideCx = Math.round(co.cx * scaleX);
        const slideCy = Math.round(co.cy * scaleY);
        const newXml = patchElementXfrmDirect(childXml, slideX, slideY, slideCx, slideCy, child.transform.rot);
        liftedXmls.push(newXml);
    }
    // Remove the group from the slide
    slide.elements = slide.elements.filter((e) => e.id !== sourceId);
    if (liftedXmls.length === 0) {
        // Empty group or extraction failed; just materialize
        slide.structureDirty = true;
        return materializeSlide(opened, slideIndex);
    }
    const result = appendRawElements(opened, slideIndex, liftedXmls);
    return result?.slide ?? null;
}
/**
 * Replace the xfrm coordinates in an XML slice with new values directly (a:xfrm
 * or p:xfrm). Only changes <a:off>/<a:ext>, leaving rot/flip alone.
 * Conservative strategy: find the first xfrm block and replace off/ext inside it;
 * do nothing if none is found.
 */
function patchElementXfrmDirect(xml, x, y, cx, cy, rot) {
    // Match an a:xfrm or p:xfrm block (non-greedy)
    const xfrmRe = /(<(?:a|p):xfrm\b[^>]*>)([\s\S]*?)(<\/(?:a|p):xfrm>)/;
    const m = xfrmRe.exec(xml);
    if (!m)
        return xml;
    const openTag = m[1];
    const closeTag = m[3];
    // A nested group's child coordinate system is kept verbatim (losing it scrambles all child coordinates)
    const chOff = /<a:chOff\b[^>]*\/>/.exec(m[2])?.[0] ?? '';
    const chExt = /<a:chExt\b[^>]*\/>/.exec(m[2])?.[0] ?? '';
    const inner = `<a:off x="${x}" y="${y}"/>` + `<a:ext cx="${cx}" cy="${cy}"/>` + chOff + chExt;
    const rotAttr = rot ? ` rot="${rot}"` : '';
    // Keep the flipH/flipV attributes (extracted from openTag)
    const flipH = /flipH="1"/.test(openTag) ? ' flipH="1"' : '';
    const flipV = /flipV="1"/.test(openTag) ? ' flipV="1"' : '';
    const tag = openTag.startsWith('<a:') ? 'a:xfrm' : 'p:xfrm';
    const newOpen = `<${tag}${rotAttr}${flipH}${flipV}>`;
    return xml.slice(0, m.index) + newOpen + inner + closeTag + xml.slice(m.index + m[0].length);
}
// ── In-group editing (patching group children; no ungrouping) ────────────
//
// Groups save via whole-originalXml passthrough; children have no independent
// byte anchors. In-group editing applies surgical patches to child slices inside
// originalXml, with structureDirty=true triggering the save rebuild.
// Slices match model children by <p:cNvPr id> (nvId) (document order ≠ children array order).
/** End position of the <tag …> element at start (incl. closing tag; correct for self-closing and same-name nesting). */
function elementEnd(xml, start, tag) {
    const re = new RegExp(`<${tag}(?=[\\s/>])[^>]*>|</${tag}>`, 'g');
    re.lastIndex = start;
    let depth = 0;
    for (let m = re.exec(xml); m; m = re.exec(xml)) {
        if (m[0].startsWith('</')) {
            if (--depth === 0)
                return m.index + m[0].length;
        }
        else if (m[0].endsWith('/>')) {
            if (depth === 0)
                return m.index + m[0].length;
        }
        else {
            depth++;
        }
    }
    return -1;
}
/** Direct child slices of the group XML (document order; a nested group's inner elements are not double-counted). */
function groupChildSlices(grpXml) {
    // The content region starts after the group's own </p:grpSpPr> (preceded by the group's nv/grpSpPr)
    const prEnd = grpXml.indexOf('</p:grpSpPr>');
    let pos = prEnd >= 0 ? prEnd + '</p:grpSpPr>'.length : 0;
    const openRe = /<p:(sp|pic|grpSp|graphicFrame|cxnSp)(?=[\s/>])/g;
    const slices = [];
    for (;;) {
        openRe.lastIndex = pos;
        const m = openRe.exec(grpXml);
        if (!m)
            break;
        const end = elementEnd(grpXml, m.index, `p:${m[1]}`);
        if (end < 0)
            break;
        const xml = grpXml.slice(m.index, end);
        const nvId = /<p:cNvPr\b[^>]*\bid="([^"]+)"/.exec(xml)?.[1];
        slices.push({ start: m.index, end, xml, ...(nvId != null ? { nvId } : {}) });
        pos = end;
    }
    return slices;
}
/** Patch the in-group slice matching child.nvId in place; returns true on success. */
function patchGroupChildXml(grp, child, patch) {
    if (!child.nvId)
        return false;
    const grpXml = grp.anchor.originalXml;
    const slice = groupChildSlices(grpXml).find((s) => s.nvId === child.nvId);
    if (!slice)
        return false;
    grp.anchor.originalXml = grpXml.slice(0, slice.start) + patch(slice.xml) + grpXml.slice(slice.end);
    return true;
}
/** Top-level group and its direct child (in-group editing goes one level; a nested subgroup is edited as a whole). */
function findGroupChild(slide, groupId, childId) {
    const grp = slide.elements.find((e) => e.id === groupId && e.type === 'group');
    const child = grp?.children.find((c) => c.id === childId);
    return grp && child ? { grp, child } : null;
}
/** Group-child geometry editing (offset is in the child EMU coordinate system, incl. chOff). */
function editGroupChildTransform(slide, groupId, childId, offset, rotationDeg) {
    const found = findGroupChild(slide, groupId, childId);
    if (!found)
        return false;
    const { grp, child } = found;
    const prev = child.transform;
    child.transform = { ...child.transform, offset, rot: Math.round(rotationDeg * 60000) };
    // patchElementXfrm reads the model transform; injects spPr when a placeholder child has no xfrm
    if (!patchGroupChildXml(grp, child, (xml) => (0, generate_1.patchElementXfrm)(child, xml))) {
        child.transform = prev;
        return false;
    }
    slide.structureDirty = true;
    return true;
}
/** Group-child text editing: called after model paragraphs are updated; regenerates the slice's txBody. */
function patchGroupChildText(slide, groupId, child) {
    const grp = slide.elements.find((e) => e.id === groupId && e.type === 'group');
    if (!grp)
        return false;
    if (!patchGroupChildXml(grp, child, (xml) => (0, generate_1.patchTextElementXml)(child, xml)))
        return false;
    slide.structureDirty = true;
    return true;
}
/** Change font/size on a whole group child (same run-level semantics as setElementFont). */
function setGroupChildFont(slide, groupId, childId, patch) {
    const found = findGroupChild(slide, groupId, childId);
    const child = found?.child;
    if (!child || (child.type !== 'text' && child.type !== 'shape'))
        return false;
    const t = child;
    if (!t.text?.paragraphs.length)
        return false;
    applyFontPatch(t.text.paragraphs, patch);
    return patchGroupChildText(slide, groupId, t);
}
/** Group-child fill ('none' | #RRGGBB(AA) | gradient). */
function editGroupChildFill(slide, groupId, childId, fill) {
    const found = findGroupChild(slide, groupId, childId);
    const child = found?.child;
    if (!child || (child.type !== 'text' && child.type !== 'shape'))
        return false;
    child.fill =
        typeof fill === 'string'
            ? fill === 'none'
                ? { type: 'none' }
                : { type: 'solid', color: fill }
            : {
                type: 'gradient',
                stops: fill.stops,
                ...(fill.angle != null ? { angle: fill.angle } : {}),
                ...(fill.radial ? { path: 'circle' } : {}),
            };
    if (!patchGroupChildXml(found.grp, child, (xml) => (0, generate_1.patchElementFill)(xml, fill)))
        return false;
    slide.structureDirty = true;
    return true;
}
/** Group-child stroke (null = remove the stroke). */
function editGroupChildStroke(slide, groupId, childId, stroke) {
    const found = findGroupChild(slide, groupId, childId);
    const child = found?.child;
    if (!child || (child.type !== 'text' && child.type !== 'shape' && child.type !== 'picture'))
        return false;
    const t = child;
    t.stroke = stroke
        ? {
            fill: { type: 'solid', color: stroke.color },
            width: stroke.widthEmu,
            ...(stroke.dash ? { dash: stroke.dash } : {}),
        }
        : undefined;
    if (!patchGroupChildXml(found.grp, child, (xml) => (0, generate_1.patchElementStroke)(xml, stroke)))
        return false;
    slide.structureDirty = true;
    return true;
}
