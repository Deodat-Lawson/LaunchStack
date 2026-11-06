/** Product DTO for the isolated role-pair milestone; generated advice never implies an action. */
import type { DemoReport, DemoState } from "./demo-contract";
export interface RoleSelectionProvenance {
    primaryRoleId?: string;
    roleIds: string[];
    mappingVersion: string;
    persistedMappingVersion: string | null;
    revision: number;
    userConfirmed: boolean;
    fallback: boolean;
}
export interface RoleContextualReport extends DemoReport {
    roleSelection: RoleSelectionProvenance;
    sourceSetHash: string;
    historyHash: string;
    contextKey: string;
}
export interface RoleContextualReportSummary {
    id: string;
    weekStart: string;
    version: number;
    generatedAt: string;
    roleSelection: RoleSelectionProvenance;
    sourceSetHash: string;
    historyHash: string;
    contextKey: string;
}
export interface RoleContextualState extends Omit<DemoState, "report"> {
    report: RoleContextualReport | null;
    reports: RoleContextualReportSummary[];
}
