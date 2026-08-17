import { join } from "node:path";
import { codexDevelopmentEnvironment, runCodexDevelopment } from "../codex-development.js";
import type { DevelopmentEnginePluginFactory } from "../development-engine-plugin-contract.js";

export const createCodexDevelopmentEnginePlugin: DevelopmentEnginePluginFactory = (context) => ({
  manifest: {
    id: "codex",
    name: "Codex",
    packageName: "@openai/codex",
    integration: "package-adapter",
    default: false,
    presentation: { tagline: "精确检查与分级控制", bestFor: "代码审查、复杂修改和需要完全控制的任务" },
    capabilities: { sessionResume: true, structuredEvents: true, isolatedWorkspace: false, eventDelivery: "live", isolation: "best-effort" },
  },
  readiness: codexDevelopmentEnvironment,
  run: (request) => runCodexDevelopment({
    ...request,
    agentDir: join(context.dataDir, "codex-development"),
    proposalStore: context.proposalStore,
  }),
});
