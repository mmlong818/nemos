import { startModelHarness } from "./companion-model-harness.js";

/** Isolated UI fixture: the app and queue are real; model content is deliberately synthetic. */
async function main() {
  const h = await startModelHarness();
  try {
    h.state.replyFor = (body) => {
      if (!body.messages?.[0]?.content.includes("最终交付协议")) return "[S1] 仅用本次合成资料整理；未读取私人记忆，未调用工具。";
      const input = JSON.parse(body.messages.at(-1).content);
      return JSON.stringify({ summary: "这是隔离界面测试的模拟简报，不是真实模型质量结论。", fields: input.requiredFields.map((label: string) => ({ label, value: "测试值：10月6日", sources: ["S1（合成资料）"] })) });
    };
    const res = await fetch(h.base + "/api/llm-config", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1", model: "manual", selectionMode: "manual" }) });
    if (!res.ok) throw new Error("Failed to configure local fixture");
    console.log(JSON.stringify({ base: h.base, stopUrl: h.modelBase + "/__qa/stop", dataDir: h.dir }));
  } catch (error) { await h.stop(); throw error; }
}
void main();
