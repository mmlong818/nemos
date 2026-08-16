import { join } from "node:path";
import type { DevelopmentEnginePluginFactory } from "../development-engine-plugin-contract.js";
import { kiloDevelopmentEnvironment, runKiloDevelopment } from "../kilo-development.js";

export const createKiloDevelopmentEnginePlugin: DevelopmentEnginePluginFactory = (context) => ({
  manifest: {
    id: "kilo",
    name: "Kilo Code",
    packageName: "@kilocode/cli",
    integration: "package-adapter",
    default: false,
    presentation: { tagline: "专注实现的独立引擎", bestFor: "目标明确、希望集中完成代码修改的任务" },
    capabilities: { sessionResume: false, structuredEvents: true, isolatedWorkspace: true, eventDelivery: "after-run", isolation: "develop-only" },
  },
  readiness: kiloDevelopmentEnvironment,
  run: (request) => runKiloDevelopment({
    ...request,
    agentDir: join(context.dataDir, "kilo-development"),
    proposalStore: context.proposalStore,
  }),
});
