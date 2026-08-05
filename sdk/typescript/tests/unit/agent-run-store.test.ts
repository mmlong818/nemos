import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AgentRuntime, FileAgentRunStore, type AgentModel, type AgentTool } from "../../src/agent/index.js";

test("persists checkpoints, terminal status, audit metadata, and redacted tool results", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-agent-runs-"));
  const file = join(dir, "runs.json");
  try {
    let modelCall = 0;
    const model: AgentModel = {
      complete: async () => ++modelCall === 1
        ? { text: "", toolCalls: [{ id: "call-1", name: "lookup", arguments: { token: "secret" } }], inputTokens: 50, outputTokens: 5 }
        : { text: "finished", inputTokens: 60, outputTokens: 6 },
    };
    const tool: AgentTool = {
      definition: {
        name: "lookup",
        description: "lookup",
        inputSchema: { type: "object", additionalProperties: true },
        effect: "read",
      },
      execute: async () => ({ content: "Bearer private-token and sk-1234567890abcdef" }),
    };
    const store = new FileAgentRunStore(file, { toolResultMode: "summary" });
    const result = await new AgentRuntime(model, [tool]).run({
      sessionId: "persisted-run",
      systemPrompt: "system",
      prompt: "go",
      metadata: { userId: "user-a", personaId: "persona-a" },
      observer: store,
    });

    assert.equal(result.output, "finished");
    const saved = store.get("persisted-run");
    assert.equal(saved?.status, "completed");
    assert.equal(saved?.rounds, 2);
    assert.deepEqual(saved?.usage, { inputTokens: 110, outputTokens: 11, totalTokens: 121, modelCalls: 2 });
    assert.deepEqual(store.list()[0]?.usage, saved?.usage);
    assert.equal(saved?.metadata?.userId, "user-a");
    assert.equal(saved?.messages.some((message) => message.role === "tool"), true);
    const raw = readFileSync(file, "utf8");
    assert.doesNotMatch(raw, /private-token|sk-1234567890abcdef/);
    assert.match(raw, /\[REDACTED\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("marks an unfinished run as interrupted when the store is reopened", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-agent-recover-"));
  const file = join(dir, "runs.json");
  try {
    writeFileSync(file, JSON.stringify({
      version: 1,
      runs: [{
        sessionId: "crashed-run",
        status: "running",
        startedAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T00:00:00.000Z",
        systemPrompt: "system",
        prompt: "go",
        rounds: 1,
        handoffs: 0,
        output: "",
        messages: [{ role: "user", content: "go" }],
        events: [],
      }],
    }));

    const store = new FileAgentRunStore(file);
    assert.equal(store.get("crashed-run")?.runId, "crashed-run");
    assert.equal(store.get("crashed-run")?.sessionId, "crashed-run");
    assert.equal(store.get("crashed-run")?.status, "interrupted");
    assert.match(store.get("crashed-run")?.error ?? "", /stopped before/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persists context handoff events as well as the final handoff count", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-agent-handoff-"));
  const file = join(dir, "runs.json");
  try {
    const store = new FileAgentRunStore(file);
    await new AgentRuntime({ complete: async () => ({ text: "done" }) }, [], {
      handoffThresholdChars: 20,
      createHandoff: async () => "bounded summary",
    }).run({
      sessionId: "handoff-run",
      systemPrompt: "system",
      history: [{ role: "user", content: "x".repeat(40) }],
      prompt: "latest",
      observer: store,
    });

    const saved = store.get("handoff-run");
    assert.equal(saved?.handoffs, 1);
    assert.equal(saved?.events.some((item) => item.event.type === "handoff"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("replays the append-only event log and exposes a safe restart checkpoint", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-agent-resume-"));
  const file = join(dir, "runs.jsonl");
  try {
    const input = {
      sessionId: "restart-safe",
      systemPrompt: "system",
      prompt: "create it",
      metadata: { personaId: "clownfish", mode: "chat" },
    };
    const checkpoint = {
      phase: "after_model" as const,
      round: 1,
      nextRound: 1,
      messages: [
        { role: "system" as const, content: "system" },
        { role: "user" as const, content: "create it" },
        {
          role: "assistant" as const,
          content: "",
          toolCalls: [{ id: "write-1", name: "write", arguments: { title: "x" } }],
        },
      ],
      handoffs: 0,
      previousToolCallSignature: "write",
      repeatedToolCallCount: 1,
      pendingToolCalls: [{ id: "write-1", name: "write", arguments: { title: "x" } }],
    };
    const store = new FileAgentRunStore(file);
    store.onStart(input, checkpoint.messages);
    store.onCheckpoint(input.sessionId, checkpoint);

    const reopened = new FileAgentRunStore(file);
    const saved = reopened.get(input.sessionId);
    const recovery = reopened.getResumeState(input.sessionId);
    assert.equal(saved?.status, "interrupted");
    assert.equal(saved?.resumable, true);
    assert.equal(recovery.resumable, true);
    assert.deepEqual(recovery.checkpoint?.pendingToolCalls, checkpoint.pendingToolCalls);
    const records = readFileSync(file, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(records.length >= 3);
    assert.ok(records.every((record) => record.version === 2));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("blocks automatic replay when an approved write has no terminal tool result", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-agent-unsafe-resume-"));
  const file = join(dir, "runs.jsonl");
  try {
    const call = { id: "write-unsafe", name: "write", arguments: {} };
    const store = new FileAgentRunStore(file);
    const input = { sessionId: "restart-unsafe", systemPrompt: "system", prompt: "go" };
    const messages = [
      { role: "system" as const, content: "system" },
      { role: "user" as const, content: "go" },
      { role: "assistant" as const, content: "", toolCalls: [call] },
    ];
    store.onStart(input, messages);
    store.onCheckpoint(input.sessionId, {
      phase: "after_model",
      round: 1,
      nextRound: 1,
      messages,
      handoffs: 0,
      previousToolCallSignature: "write",
      repeatedToolCallCount: 1,
      pendingToolCalls: [call],
    });
    store.onEvent(input.sessionId, { type: "tool_start", call });
    store.onEvent(input.sessionId, {
      type: "tool_authorization",
      call,
      allowed: true,
      reason: "approved",
    });

    const reopened = new FileAgentRunStore(file);
    const recovery = reopened.getResumeState(input.sessionId);
    assert.equal(recovery.resumable, false);
    assert.match(recovery.reason ?? "", /may have executed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("stores multiple runs independently under one long-lived session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-agent-run-session-split-"));
  const file = join(dir, "runs.jsonl");
  try {
    const store = new FileAgentRunStore(file);
    for (const runId of ["run-one", "run-two"]) {
      await new AgentRuntime({ complete: async () => ({ text: runId }) }, []).run({
        runId,
        sessionId: "conversation-one",
        systemPrompt: "system",
        prompt: runId,
        observer: store,
      });
    }

    assert.equal(store.get("run-one")?.output, "run-one");
    assert.equal(store.get("run-two")?.output, "run-two");
    const runs = store.list({ limit: 10 }).filter((run) => run.sessionId === "conversation-one");
    assert.equal(runs.length, 2);
    assert.deepEqual(new Set(runs.map((run) => run.runId)), new Set(["run-one", "run-two"]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});