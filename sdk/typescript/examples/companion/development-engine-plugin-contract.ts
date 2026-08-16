import type { DevelopmentReasoning } from "./capabilities.js";
import type { DevelopmentApprovalPolicy } from "./development-approval.js";
import type { DevelopmentEngine } from "./development-engine-contract.js";
import type { DevelopmentProposalStore } from "./development-proposals.js";
import type { CompanionModelConnection } from "./model-connection.js";
import type {
  DevelopmentAccessMode,
  DevelopmentSessionMode,
  DevelopmentTelemetryEvent,
  PiDevelopmentResult,
} from "./pi-development.js";

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
  onTelemetry?: (event: DevelopmentTelemetryEvent) => void;
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
  presentation: {
    tagline: string;
    bestFor: string;
  };
  capabilities: {
    sessionResume: boolean;
    structuredEvents: boolean;
    isolatedWorkspace: boolean;
    eventDelivery: "live" | "after-run" | "summary-only";
    isolation: "always" | "develop-only" | "best-effort";
  };
}

export interface DevelopmentEnginePlugin {
  manifest: DevelopmentEngineManifest;
  readiness(): DevelopmentEngineReadiness;
  run(input: DevelopmentEngineInvocation): Promise<PiDevelopmentResult>;
}

export interface DevelopmentEnginePluginContext {
  dataDir: string;
  proposalStore: DevelopmentProposalStore;
}

export type DevelopmentEnginePluginFactory = (context: DevelopmentEnginePluginContext) => DevelopmentEnginePlugin;
