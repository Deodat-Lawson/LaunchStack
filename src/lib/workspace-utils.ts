/**
 * Utilities for conditional company / personal-workspace labelling.
 */

export type WorkspaceType = "company" | "personal";

export function getWorkspaceLabel(type: WorkspaceType): string {
    return type === "personal" ? "Workspace" : "Company";
}

export function isPersonalWorkspace(type: string | null | undefined): boolean {
    return type === "personal";
}
