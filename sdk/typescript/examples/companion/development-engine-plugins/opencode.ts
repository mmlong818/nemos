import { join } from "node:path";
import type { DevelopmentEnginePluginFactory } from "../development-engine-plugin-contract.js";
import { openCodeDevelopmentEnvironment, runOpenCodeDevelopment } from "../opencode-development.js";

export const createOpenCodeDevelopmentEnginePlugin: DevelopmentEnginePluginFactory = (context) => ({
  manifest: {
    id: "opencode",
    name: "OpenCode",
    packageName: "opencode-ai",
    integration: "package-adapter",
    default: false,
    presentation: { tagline: "开放的多模型工作流", bestFor: "需要兼容不同模型与开放工具链的任务" },
    capabilities: { sessionResume: false, structuredEvents: true, isolatedWorkspace: true, eventDelivery: "after-run", isolation: "develop-only" },
  },
  readiness: openCodeDevelopmentEnvironment,
  run: (request) => runOpenCodeDevelopment({
    ...request,
    agentDir: join(context.dataDir, "opencode-development"),
    proposalStore: context.proposalStore,
  }),
});
