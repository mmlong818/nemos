import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { ServerResponse } from "node:http";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";

import { CapabilityRuntime } from "../../examples/companion/capabilities.js";

function png(color: string): Buffer {
  const canvas = createCanvas(16, 12);
  const context = canvas.getContext("2d");
  context.fillStyle = color;
  context.fillRect(0, 0, 16, 12);
  return canvas.toBuffer("image/png");
}

function runtimeAt(dataDir: string): CapabilityRuntime {
  return new CapabilityRuntime({ dataDir, personas: () => [{ id: "clownfish", name: "小丑鱼" }], notify: async () => ({ reply: "", facts: [] }) });
}

async function readResponse(runtime: CapabilityRuntime, id: string, preview = false): Promise<Buffer | null> {
  const response = new PassThrough();
  (response as unknown as ServerResponse).writeHead = (() => response) as unknown as ServerResponse["writeHead"];
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer) => chunks.push(chunk));
  const accepted = preview
    ? runtime.previewArtifact(response as unknown as ServerResponse, id)
    : runtime.sendArtifact(response as unknown as ServerResponse, id);
  if (!accepted) return null;
  return new Promise((resolve) => response.on("end", () => resolve(Buffer.concat(chunks))));
}

test("artifact logical keys are exact IDs and same-name outputs retain distinct content proofs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-artifact-key-"));
  try {
    const runtime = runtimeAt(dir);
    const first = runtime.saveGeneratedImage(png("#d02020"), "same name");
    const second = runtime.saveGeneratedImage(png("#2040d0"), "same name");
    assert.notEqual(first.id, second.id);
    assert.notEqual(first.proof?.contentHash, second.proof?.contentHash);
    assert.deepEqual(await readResponse(runtime, first.id), readFileSync(first.file));
    assert.deepEqual(await readResponse(runtime, first.id, true), readFileSync(first.file));
    assert.equal(runtime.sendArtifact(new PassThrough() as unknown as ServerResponse, "../outside.png"), false);
    assert.equal(runtime.sendArtifact(new PassThrough() as unknown as ServerResponse, first.file), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("artifact access fails closed after content mutation and does not expose escaped context paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-artifact-proof-"));
  try {
    const runtime = runtimeAt(dir);
    const artifact = runtime.saveGeneratedImage(png("#225522"));
    writeFileSync(artifact.file, png("#522255"));
    assert.equal(await readResponse(runtime, artifact.id), null);
    assert.equal(await readResponse(runtime, artifact.id, true), null);
    assert.equal(runtime.artifactHandoff(artifact.id), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("symlinked artifact paths cannot read outside the artifact sandbox", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-artifact-symlink-"));
  try {
    const runtime = runtimeAt(dir);
    const artifact = runtime.saveGeneratedImage(png("#336699"));
    const siblingEscape = join(dir, "capabilities", "artifacts-escape");
    mkdirSync(siblingEscape, { recursive: true });
    const outside = join(siblingEscape, "outside.png");
    writeFileSync(outside, png("#996633"));
    unlinkSync(artifact.file);
    try { symlinkSync(outside, artifact.file, "file"); }
    catch (error) {
      t.skip(`file symlink creation is unavailable on this platform: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    assert.equal(await readResponse(runtime, artifact.id), null);
    writeFileSync(join(dir, "capabilities", "retained-artifacts.json"), JSON.stringify([{ ...artifact, retainedAt: new Date().toISOString() }]), "utf8");
    assert.equal(runtimeAt(dir).deleteRetainedArtifact(artifact.id), true);
    assert.equal(existsSync(outside), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("legacy artifacts without proof remain readable after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-artifact-legacy-"));
  try {
    const runtime = runtimeAt(dir);
    const artifact = runtime.saveGeneratedImage(png("#777777"));
    const index = join(dir, "capabilities", "artifacts.json");
    const entries = JSON.parse(readFileSync(index, "utf8")) as Array<Record<string, unknown>>;
    const stored = entries.find((item) => item.id === artifact.id)!;
    delete stored.proof;
    writeFileSync(index, JSON.stringify(entries), "utf8");
    const restarted = runtimeAt(dir);
    assert.deepEqual(await readResponse(restarted, artifact.id), readFileSync(artifact.file));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an explicitly empty proof is rejected instead of treated as a legacy record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-artifact-empty-proof-"));
  try {
    const runtime = runtimeAt(dir);
    const artifact = runtime.saveGeneratedImage(png("#787878"));
    const index = join(dir, "capabilities", "artifacts.json");
    const entries = JSON.parse(readFileSync(index, "utf8")) as Array<Record<string, unknown>>;
    const stored = entries.find((item) => item.id === artifact.id)!;
    stored.proof = null;
    writeFileSync(index, JSON.stringify(entries), "utf8");
    assert.equal(await readResponse(runtimeAt(dir), artifact.id), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("persisted artifact paths outside the artifact root are rejected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-artifact-path-"));
  try {
    const runtime = runtimeAt(dir);
    const artifact = runtime.saveGeneratedImage(png("#555555"));
    const outside = join(dir, "outside.png");
    writeFileSync(outside, "SYNTHETIC_OUTSIDE_ARTIFACT_SECRET", "utf8");
    const index = join(dir, "capabilities", "artifacts.json");
    const entries = JSON.parse(readFileSync(index, "utf8")) as Array<Record<string, unknown>>;
    entries.find((item) => item.id === artifact.id)!.file = outside;
    writeFileSync(index, JSON.stringify(entries), "utf8");
    const restarted = runtimeAt(dir);
    assert.equal(await readResponse(restarted, artifact.id), null);
    assert.deepEqual(restarted.searchLocal({ query: "SYNTHETIC_OUTSIDE_ARTIFACT_SECRET", kinds: ["artifact"] }).results, []);
    assert.equal(existsSync(outside), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("artifact search does not read an escaped preview path", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-artifact-search-preview-"));
  try {
    const runtime = runtimeAt(dir);
    const artifact = runtime.saveGeneratedImage(png("#444444"));
    const outside = join(dir, "outside-preview.html");
    writeFileSync(outside, "SYNTHETIC_OUTSIDE_PREVIEW_SECRET", "utf8");
    const index = join(dir, "capabilities", "artifacts.json");
    const entries = JSON.parse(readFileSync(index, "utf8")) as Array<Record<string, unknown>>;
    entries.find((item) => item.id === artifact.id)!.previewFile = outside;
    writeFileSync(index, JSON.stringify(entries), "utf8");
    assert.deepEqual(runtimeAt(dir).searchLocal({ query: "SYNTHETIC_OUTSIDE_PREVIEW_SECRET", kinds: ["artifact"] }).results, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("persisted research context paths outside the artifact root are not read", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-artifact-context-"));
  try {
    const runtime = runtimeAt(dir);
    const artifact = runtime.saveGeneratedImage(png("#121212"));
    const outside = join(dir, "outside-context.md");
    writeFileSync(outside, "SYNTHETIC_OUTSIDE_CONTEXT_SECRET", "utf8");
    const index = join(dir, "capabilities", "artifacts.json");
    const entries = JSON.parse(readFileSync(index, "utf8")) as Array<Record<string, unknown>>;
    const stored = entries.find((item) => item.id === artifact.id)!;
    stored.capabilityId = "research-brief";
    stored.metadata = { contextFile: outside };
    writeFileSync(index, JSON.stringify(entries), "utf8");
    const restarted = runtimeAt(dir);
    const state = restarted.artifactWorkspace(artifact.id);
    assert.ok(state);
    assert.doesNotMatch(JSON.stringify(state), /SYNTHETIC_OUTSIDE_CONTEXT_SECRET/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
