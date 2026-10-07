import { createCanvas, Image } from "@napi-rs/canvas";

export interface PngValidationReceipt {
  width: number;
  height: number;
  byteLength: number;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PIXELS = 16_000_000;

function crc32(data: Buffer, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc ^= data[index]!;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function reasonableDimensions(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1 && width <= 8192 && height <= 8192 && width * height <= MAX_PIXELS;
}

/** Decode every pixel before accepting a generated image as a deliverable. */
export function validateGeneratedPng(data: Buffer): PngValidationReceipt {
  if (!data.subarray(0, 8).equals(SIGNATURE)) throw new Error("生成结果不是有效 PNG 图片。");
  if (data.length < 33 || data.readUInt32BE(8) !== 13 || data.toString("ascii", 12, 16) !== "IHDR" || !reasonableDimensions(data.readUInt32BE(16), data.readUInt32BE(20))) {
    throw new Error("生成结果不是有效 PNG 图片：图片尺寸或文件头不合理。");
  }
  let offset = 8;
  let hasImageData = false;
  let ended = false;
  let firstChunk = true;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > data.length) break;
    const type = data.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || (firstChunk && type !== "IHDR")) throw new Error("生成结果不是有效 PNG 图片：块顺序或类型无效。");
    if (data.readUInt32BE(end - 4) !== crc32(data, offset + 4, end - 4)) throw new Error("生成结果不是有效 PNG 图片：块校验失败。");
    firstChunk = false;
    if (type === "IDAT") hasImageData = true;
    if (type === "IEND") {
      ended = length === 0 && end === data.length;
      break;
    }
    offset = end;
  }
  if (!hasImageData || !ended) throw new Error("生成结果不是有效 PNG 图片：文件不完整。");
  try {
    const image = new Image();
    image.src = data;
    const { width, height } = image;
    if (!reasonableDimensions(width, height)) {
      throw new Error("图片尺寸不在 1–8192 像素及 1600 万像素以内。");
    }
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    context.getImageData(0, 0, width, height);
    return { width, height, byteLength: data.length };
  } catch (error) {
    throw new Error(`生成结果不是有效 PNG 图片：${error instanceof Error ? error.message : String(error)}`);
  }
}
