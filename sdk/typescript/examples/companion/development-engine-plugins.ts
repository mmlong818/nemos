import { join } from "node:path";
import { runCodexDevelopment, codexDevelopmentEnvironment } from "./codex-development.js";
import { runDshDevelopment, dshDevelopmentEnvironment } from "./dsh-development.js";
import {
  DEVELOPMENT_ENGINES,
  type DevelopmentEngine,
} from "./development-engine-contract.js";
import type { DevelopmentApprovalPolicy } from "./development-approval.js";
import type { DevelopmentProposalStore } from "./development-proposals.js";
import { runKiloDevelopment, kiloDevelopmentEnvironment } from "./kilo-development.js";
import type { CompanionModelConnection } from "./model-connection.js";
import { runOpenCodeDevelopment, openCodeDevelopmentEnvironment } from "./opencode-development.js";
import {
  runPiDevelopment,
  type DevelopmentAccessMode,
  type DevelopmentSessionMode,
  type PiDevelopmentResult,
} from "./pi-development.js";
import type { DevelopmentReasoning } from "./capabilities.js";

export interface DevelopmentEngineInvocation {
  workspacePath: string;
  instruction: string;
  accessMode: DevelopmentAccessMode;
  approvalPolicy?: DevelopmentApprovalPolicy;
  installDependencies?: boolean;
  connection: CompanionModelConnection;
  reasoning?: DevelopmentReasoning;
  signal?: AbortSignal;
  onProgress?: (message: string, percent: number) => void;
  sessionMode?: DevelopmentSessionMode;
  sessionFile?: string;
}

export interface DevelopmentEngineReadiness {
  available: boolean;
  version: string;
}

export interface DevelopmentEngineManifest {
  id: DevelopmentEngine;
  name: string;
  packageName: string;
  integration: "package-adapter";
  default: boolean;
}

export interface DevelopmentEnginePlugin {
  manifest: DevelopmentEngineManifest;
  readiness(): DevelopmentEngineReadiness;
  run(input: DevelopmentEngineInvocation): Promise<PiDevelopmentResult>;
}

export class DevelopmentEnginePluginRegistry {
  readonly #plugins = new Map<DevelopmentEngine, DevelopmentEnginePlugin>();

  constructor(plugins: readonly DevelopmentEnginePlugin[]) {
    for (const plugin of plugins) {
      if (this.#plugins.has(plugin.manifest.id)) {
        throw new Error(`开发引擎插件重复：${plugin.manifest.id}`);
      }
      this.#plugins.set(plugin.manifest.id, plugin);
    }
    const missing = DEVELOPMENT_ENGINES.filter((id) => !this.#plugins.has(id));
    if (missing.length) throw new Error(`开发引擎插件缺失：${missing.join("、")}`);
  }

  list(): DevelopmentEngineManifest[] {
    return DEVELOPMENT_ENGINES.map((id) => ({ ...this.#plugins.get(id)!.manifest }));
  }

  readiness(): Record<DevelopmentEngine, DevelopmentEngineReadiness> {
    return Object.fromEntries(DEVELOPMENT_ENGINES.map((id) => [id, this.#plugins.get(id)!.readiness()])) as Record<DevelopmentEngine, DevelopmentEngineReadiness>;
  }

  run(engine: DevelopmentEngine, input: DevelopmentEngineInvocation): Promise<PiDevelopmentResult> {
    return this.#plugins.get(engine)!.run(input);
  }
}

export function createDevelopmentEnginePluginRegistry(input: {
  dataDir: string;
  proposalStore: DevelopmentProposalStore;
}): DevelopmentEnginePluginRegistry {
  const common = (engine: DevelopmentEngine) => ({
    agentDir: join(input.dataDir, `${engine}-development`),
    proposalStore: input.proposalStore,
  });
  return new DevelopmentEnginePluginRegistry([
    {
      manifest: manifest("pi", "Pi Agent", "@earendil-works/pi-coding-agent", true),
      readiness: () => ({ available: true, version: "内置依赖" }),
      run: (request) => runPiDevelopment({
        ...request,
        ...common("pi"),
        skillPaths: [join(input.dataDir, "skills")],
      }),
    },
    {
      manifest: manifest("dsh", "DeepSeek Harness", "@deepseek-ai/dsh"),
      readiness: dshDevelopmentEnvironment,
      run: (request) => runDshDevelopment({ ...request, ...common("dsh") }),
    },
    {
      manifest: manifest("kilo", "Kilo Code", "@kilocode/cli"),
      readiness: kiloDevelopmentEnvironment,
      run: (request) => runKiloDevelopment({ ...request, ...common("kilo") }),
    },
    {
      manifest: manifest("opencode", "OpenCode", "opencode-ai"),
      readiness: openCodeDevelopmentEnvironment,
      run: (request) => runOpenCodeDevelopment({ ...request, ...common("opencode") }),
    },
    {
      manifest: manifest("codex", "Codex", "@openai/codex"),
      readiness: codexDevelopmentEnvironment,
      run: (request) => runCodexDevelopment({ ...request, ...common("codex") }),
    },
  ]);
}

function manifest(
  id: DevelopmentEngine,
  name: string,
  packageName: string,
  isDefault = false,
): DevelopmentEngineManifest {
  return { id, name, packageName, integration: "package-adapter", default: isDefault };
}
