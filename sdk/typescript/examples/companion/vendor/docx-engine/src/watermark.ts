import { escapeXmlAttr } from './xml-utils'

/**
 * Text watermark support. Word implements watermarks as a VML shape with a
 * v:textpath inside the page header; the shape floats behind the body text
 * on every page that uses that header.
 */

/** namespaces the header part root needs when it carries a VML watermark */
export const WATERMARK_NS =
  ' xmlns:v="urn:schemas-microsoft-com:vml"' +
  ' xmlns:o="urn:schemas-microsoft-com:office:office"' +
  ' xmlns:w10="urn:schemas-microsoft-com:office:word"'

/** read the watermark text from a header part; null when it has none */
export function readWatermarkText(headerXml: string): string | null {
  if (!headerXml.includes('<v:textpath')) return null
  const m = /<v:textpath[^>]*\bstring="([^"]*)"/.exec(headerXml)
  if (!m) return null
  const text = m[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
  return text || null
}

/**
 * The diagonal gray text watermark paragraph Word generates (shapetype 136 =
 * text-on-path). Lives as the first paragraph of the header part.
 */
export function watermarkParagraphXml(text: string): string {
  const shape =
    '<v:shape id="PowerPlusWaterMarkObject1" o:spid="_x0000_s2049" type="#_x0000_t136"' +
    ' style="position:absolute;left:0;text-align:left;margin-left:0;margin-top:0;' +
    'width:412.4pt;height:247.45pt;rotation:315;z-index:-251656192;' +
    'mso-position-horizontal:center;mso-position-horizontal-relative:margin;' +
    'mso-position-vertical:center;mso-position-vertical-relative:margin"' +
    ' o:allowincell="f" fillcolor="silver" stroked="f">' +
    '<v:fill opacity=".5"/>' +
    `<v:textpath style="font-family:&quot;DengXian&quot;;font-size:1pt" string="${escapeXmlAttr(text)}"/>` +
    '</v:shape>'
  const shapetype =
    '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800"' +
    ' path="m@7,l@8,m@5,21600l@6,21600e">' +
    '<v:formulas>' +
    '<v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/>' +
    '<v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/>' +
    '<v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/>' +
    '<v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/>' +
    '<v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/>' +
    '</v:formulas>' +
    '<v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800"' +
    ' o:connectangles="270,180,90,0"/>' +
    '<v:textpath on="t" fitshape="t"/>' +
    '<v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles>' +
    '<o:lock v:ext="edit" text="t" shapetype="t"/>' +
    '</v:shapetype>'
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:pict>${shapetype}${shape}</w:pict></w:r></w:p>`
}
