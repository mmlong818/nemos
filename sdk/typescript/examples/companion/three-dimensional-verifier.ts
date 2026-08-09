import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { spawnSync } from "node:child_process";

import type { ProfessionalArtifactCheck } from "./professional-artifact-gate.js";

export interface ThreeDimensionalVerificationReceipt {
  version: 1;
  tool: "blender";
  checkedAt: string;
  fileHash: string;
  objectCount: number;
  meshCount: number;
  dimensions: [number, number, number];
  passed: boolean;
  detail: string;
  unavailableReason?: string;
}

export function verifyThreeDimensionalArtifact(file: string): ThreeDimensionalVerificationReceipt {
  const checkedAt = new Date().toISOString();
  const blender = findBlenderExecutable();
  if (!blender) return unavailable(checkedAt, "未找到 Blender，无法执行三维领域核验");
  if (!existsSync(file) || !statSync(file).isFile()) return unavailable(checkedAt, "三维产物不存在");
  if (extname(file).toLowerCase() !== ".blend") return unavailable(checkedAt, "当前真实核验器只接受 Blender .blend 文件");
  const data = readFileSync(file);
  const fileHash = createHash("sha256").update(data).digest("hex");
  const code = [
    "import bpy,json,math",
    `bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(file)})`,
    "objects=[o for o in bpy.context.scene.objects if not o.hide_render]",
    "meshes=[o for o in objects if o.type=='MESH']",
    "points=[o.matrix_world @ v.co for o in meshes for v in o.data.vertices]",
    "dims=[0.0,0.0,0.0] if not points else [max(p[i] for p in points)-min(p[i] for p in points) for i in range(3)]",
    "payload={'objectCount':len(objects),'meshCount':len(meshes),'dimensions':dims}",
    "print('CLOWNFISH_3D_RECEIPT='+json.dumps(payload,separators=(',',':')))",
  ].join(";");
  const result = spawnSync(blender, ["--background", "--factory-startup", "--python-expr", code], {
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  const marker = `${result.stdout || ""}\n${result.stderr || ""}`.match(/CLOWNFISH_3D_RECEIPT=(\{[^\r\n]+\})/);
  if (result.status !== 0 || !marker?.[1]) {
    return { version: 1, tool: "blender", checkedAt, fileHash, objectCount: 0, meshCount: 0, dimensions: [0, 0, 0], passed: false, detail: "Blender 无法打开或检查这个三维产物" };
  }
  try {
    const parsed = JSON.parse(marker[1]) as { objectCount?: number; meshCount?: number; dimensions?: number[] };
    const dimensions = normalizeDimensions(parsed.dimensions);
    const objectCount = Math.max(0, Number(parsed.objectCount || 0));
    const meshCount = Math.max(0, Number(parsed.meshCount || 0));
    const passed = objectCount > 0 && meshCount > 0 && dimensions.some((value) => value > 0) && dimensions.every((value) => Number.isFinite(value) && value < 1e9);
    return {
      version: 1,
      tool: "blender",
      checkedAt,
      fileHash,
      objectCount,
      meshCount,
      dimensions,
      passed,
      detail: passed
        ? `Blender 打开成功：${objectCount} 个对象、${meshCount} 个网格，包围尺寸 ${dimensions.map((value) => value.toFixed(3)).join(" × ")}`
        : "文件可以打开，但没有形成可核验的有效网格场景",
    };
  } catch {
    return { version: 1, tool: "blender", checkedAt, fileHash, objectCount: 0, meshCount: 0, dimensions: [0, 0, 0], passed: false, detail: "Blender 核验回执无法解析" };
  }
}

export function findBlenderExecutable(): string | null {
  const candidates = [
    process.env.NEMOS_BLENDER_PATH,
    "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe",
    "C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe",
    "C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe",
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ?? null;
}

export function threeDimensionalVerificationCheck(receipt: ThreeDimensionalVerificationReceipt): ProfessionalArtifactCheck {
  return {
    id: "blender-scene-health",
    label: "Blender 场景健康检查",
    required: true,
    passed: receipt.passed,
    phase: "verification",
    detail: receipt.detail,
  };
}

function normalizeDimensions(values: number[] | undefined): [number, number, number] {
  return [0, 1, 2].map((index) => Math.max(0, Number(values?.[index] || 0))) as [number, number, number];
}

function unavailable(checkedAt: string, reason: string): ThreeDimensionalVerificationReceipt {
  return { version: 1, tool: "blender", checkedAt, fileHash: "", objectCount: 0, meshCount: 0, dimensions: [0, 0, 0], passed: false, detail: reason, unavailableReason: reason };
}
