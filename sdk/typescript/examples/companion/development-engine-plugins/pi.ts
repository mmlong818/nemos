import { join } from "node:path";
import type { DevelopmentEnginePluginFactory } from "../development-engine-plugin-contract.js";
import { piDevelopmentEnvironment, runPiDevelopment } from "../pi-development.js";

export const createPiDevelopmentEnginePlugin: DevelopmentEnginePluginFactory = (context) => ({
  manifest: {
    id: "pi",
    name: "Pi Agent",
    packageName: "@earendil-works/pi-coding-agent",
    integration: "package-adapter",
    default: true,
    presentation: { tagline: "实时过程与连续迭代", bestFor: "日常开发、边做边调和需要继续上次会话的任务" },
    capabilities: { sessionResume: true, structuredEvents: true, isolatedWorkspace: false, eventDelivery: "live", isolation: "best-effort" },
  },
  readiness: piDevelopmentEnvironment,
  run: (request) => runPiDevelopment({
    ...request,
    agentDir: join(context.dataDir, "pi-development"),
    proposalStore: context.proposalStore,
    skillPaths: [join(context.dataDir, "skills")],
  }),
});
