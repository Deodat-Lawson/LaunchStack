import type { DistributionPorts, PublishDossierInput } from "./run.js";
export declare const DEFAULT_CREDITS_PER_CANDIDATE = 2000;
export interface CreateDefaultPortsOptions {
    publishDossier?: ((input: PublishDossierInput) => Promise<{
        documentId: number;
    }>) | null;
    debitCredits?: DistributionPorts["debitCredits"];
    creditsPerCandidate?: number;
    /** Set false to disable a source regardless of configuration. */
    enableWeb?: boolean;
    enablePlaces?: boolean;
}
export declare function createDefaultPorts(options?: CreateDefaultPortsOptions): DistributionPorts;
//# sourceMappingURL=ports.d.ts.map