import { VantageApiError } from "./api";

export type V2Settings = {
    goals: string[];
    personaIds: string[];
    personas: { id: string; name: string }[];
};
export type V2Task = {
    id: string;
    parentId: string | null;
    topicId: string;
    title: string;
    description: string;
    acceptanceCriterion: string;
    priority: "low" | "medium" | "high";
    assigneeType: "owner" | "persona";
    assigneeId: string;
    status:
        | "proposed"
        | "queued"
        | "running"
        | "submitted"
        | "completed"
        | "cancelled"
        | "failed"
        | "blocked";
    version: number;
    refs: string[];
    provenance: "proposal" | "grounded";
    result?: string;
    structuredResult?: {
        summary: string;
        claims: { text: string; refs: string[] }[];
        unknowns: string[];
        disposition: "ready_for_review" | "blocked";
    };
    reason?: string;
    latestAttempt?: {
        id: string;
        number: number;
        status: V2Task["status"];
        reason?: string;
        leaseUntil: string | null;
    };
};
export type V2Plan = {
    id: string;
    reviewId: string;
    version: number;
    hash: string;
    approvedVersion: number | null;
    approvedHash: string | null;
    tasks: V2Task[];
    discarded: { reason: string }[];
};
export type V2Action = "run" | "accept" | "rework" | "cancel" | "complete";
export type V2TaskPatch = Pick<
    V2Task,
    "title" | "description" | "acceptanceCriterion" | "priority" | "assigneeType" | "assigneeId"
>;

async function request<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
    const response = await fetch(`/api/vantage/planning${path}`, {
        method,
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const code =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
                ? body.error
                : "v2_unavailable";
        throw new VantageApiError(code, response.status, body);
    }
    return body as T;
}
const planPath = (id: string) => `/reviews/${encodeURIComponent(id)}/plan`;
export const v2Api = {
    settings: () => request<V2Settings>("/settings"),
    saveSettings: (settings: Pick<V2Settings, "goals" | "personaIds">) =>
        request<V2Settings>("/settings", "PUT", settings),
    plan: (reviewId: string) => request<{ plan: V2Plan | null }>(planPath(reviewId)),
    create: (reviewId: string) => request<{ plan: V2Plan }>(planPath(reviewId), "POST", {}),
    approve: (plan: V2Plan) =>
        request(planPath(plan.reviewId) + "/approve", "POST", {
            version: plan.version,
            hash: plan.hash,
        }),
    edit: (task: V2Task, patch: V2TaskPatch) =>
        request(`/tasks/${encodeURIComponent(task.id)}`, "PATCH", {
            expectedVersion: task.version,
            ...patch,
        }),
    remove: (task: V2Task) =>
        request(`/tasks/${encodeURIComponent(task.id)}`, "DELETE", {
            expectedVersion: task.version,
        }),
    action: (task: V2Task, action: V2Action, result?: string) =>
        request(`/tasks/${encodeURIComponent(task.id)}/action`, "POST", {
            action,
            expectedVersion: task.version,
            ...(result === undefined ? {} : { result }),
        }),
};
