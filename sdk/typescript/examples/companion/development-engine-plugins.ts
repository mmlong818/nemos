import { DEVELOPMENT_ENGINES, type DevelopmentEngine } from "./development-engine-contract.js";
import type {
  DevelopmentEngineInvocation,
  DevelopmentEngineManifest,
  DevelopmentEnginePlugin,
  DevelopmentEnginePluginContext,
  DevelopmentEngineReadiness,
} from "./development-engine-plugin-contract.js";
import { createCodexDevelopmentEnginePlugin } from "./development-engine-plugins/codex.js";
import { createDshDevelopmentEnginePlugin } from "./development-engine-plugins/dsh.js";
import { createKiloDevelopmentEnginePlugin } from "./development-engine-plugins/kilo.js";
import { createOpenCodeDevelopmentEnginePlugin } from "./development-engine-plugins/opencode.js";
import { createPiDevelopmentEnginePlugin } from "./development-engine-plugins/pi.js";

export type {
  DevelopmentEngineInvocation,
  DevelopmentEngineManifest,
  DevelopmentEnginePlugin,
  DevelopmentEnginePluginContext,
  DevelopmentEngineReadiness,
} from "./development-engine-plugin-contract.js";

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

  run(engine: DevelopmentEngine, input: DevelopmentEngineInvocation) {
    return this.#plugins.get(engine)!.run(input);
  }
}

const developmentEnginePluginFactories = [
  createPiDevelopmentEnginePlugin,
  createDshDevelopmentEnginePlugin,
  createKiloDevelopmentEnginePlugin,
  createOpenCodeDevelopmentEnginePlugin,
  createCodexDevelopmentEnginePlugin,
] as const;

export function createDevelopmentEnginePluginRegistry(context: DevelopmentEnginePluginContext): DevelopmentEnginePluginRegistry {
  return new DevelopmentEnginePluginRegistry(developmentEnginePluginFactories.map((createPlugin) => createPlugin(context)));
}
