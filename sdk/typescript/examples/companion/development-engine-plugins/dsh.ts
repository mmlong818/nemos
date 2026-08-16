import { join } from "node:path";
import type { DevelopmentEnginePluginFactory } from "../development-engine-plugin-contract.js";
import { dshDevelopmentEnvironment, runDshDevelopment } from "../dsh-development.js";

export const createDshDevelopmentEnginePlugin: DevelopmentEnginePluginFactory = (context) => ({
  manifest: {
    id: "dsh",
    name: "DeepSeek Harness",
    packageName: "@deepseek-ai/dsh",
    integration: "package-adapter",
    default: false,
    presentation: { tagline: "隔离执行的完整工具链", bestFor: "复杂修改、需要先在独立目录验证的任务" },
    capabilities: { sessionResume: false, structuredEvents: false, isolatedWorkspace: true, eventDelivery: "summary-only", isolation: "develop-only" },
  },
  readiness: dshDevelopmentEnvironment,
  run: (request) => runDshDevelopment({
    ...request,
    agentDir: join(context.dataDir, "dsh-development"),
    proposalStore: context.proposalStore,
  }),
});
