/**
 * Dossier → markdown for the Sources library, plus the convergent creation
 * key (the mindmap `mindmap:<id>:<revision>` rule with different nouns).
 */
import type { Dossier, EvidenceRecord, FitBreakdown, PartnerKind, PartnerOrgRecord, ProgramRecord, Territory } from "./types.js";
/** Same program, same organisation, same run ⇒ the same source. */
export declare function makeDossierCreationKey(programId: string, orgId: string, runId: string): string;
export declare function makeDossierFilename(org: PartnerOrgRecord): string;
export interface RenderDossierInput {
    program: ProgramRecord;
    org: PartnerOrgRecord;
    kind: PartnerKind;
    territory: Territory | null;
    dossier: Dossier | null;
    evidence: EvidenceRecord[];
    fit: {
        score: number;
        rationale: string;
        breakdown: FitBreakdown;
    };
    riskFlags: string[];
    screening: {
        status: string;
        provider?: string;
        flags?: Array<{
            matchedName: string;
            score: number;
            topics: string[];
        }>;
    } | null;
    generatedAt: Date;
    provenance: {
        runId: string;
        playbookHash: string;
        promptVersion: string;
        modelId?: string;
    };
}
export declare function renderDossierMarkdown(input: RenderDossierInput): string;
//# sourceMappingURL=render.d.ts.map