import type {
    CreateTrackerTask,
    SaveTrackerOpportunity,
    SimilarCompaniesView,
    TrackerOpportunity,
    TrackerTask,
    UpdateTrackerOpportunity,
    UpdateTrackerTask,
} from "@launchstack/pipelines/accelerators";
import type { HomeResponse, ProgramView, RunView } from "@launchstack/pipelines/accelerators/types";

import type { Copy } from "~/i18n/copy";

import type { ProgramDetailsMap } from "./_lib/details";

export type {
    CatalogueProgram,
    HomeResponse,
    ProgramCycle,
    ProgramView,
    SourcedNarrative,
} from "@launchstack/pipelines/accelerators/types";
export type {
    ApplicationResponse,
    ApplicationSection,
    PastCompany,
    SimilarCompaniesView,
    SimilarCompany,
    TrackerOpportunity,
    TrackerPriority,
    TrackerStatus,
    TrackerTask,
    UpdateTrackerOpportunity,
} from "@launchstack/pipelines/accelerators";

export type AcceleratorRunView = RunView & { errorCopy?: Copy };
/** Public, sourced dossier facts alongside company-specific fit results. */
export type AcceleratorsHome = HomeResponse & { details: ProgramDetailsMap };
export class AcceleratorsApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string | null,
        readonly generated = false
    ) {
        super(message);
        this.name = "AcceleratorsApiError";
    }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        ...init,
        cache: "no-store",
        headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            body = text;
        }
    }
    if (!response.ok) {
        const error =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
                ? body.error
                : null;
        const code =
            body && typeof body === "object" && "code" in body && typeof body.code === "string"
                ? body.code
                : null;
        throw new AcceleratorsApiError(
            error ?? `Request failed (${response.status})`,
            response.status,
            code,
            error === null
        );
    }
    return body as T;
}

export const acceleratorsApi = {
    home: () => call<AcceleratorsHome>("/api/accelerators"),
    program: (id: string) =>
        call<{ program: ProgramView }>(`/api/accelerators/programs/${encodeURIComponent(id)}`),
    match: (programIds: string[], rescore: boolean) =>
        call<{ run: AcceleratorRunView }>("/api/accelerators/match", {
            method: "POST",
            body: JSON.stringify({ programIds, rescore }),
        }),
    run: (id: string) =>
        call<{ run: AcceleratorRunView }>(`/api/accelerators/runs/${encodeURIComponent(id)}`),
    similar: (id: string) =>
        call<{ similar: SimilarCompaniesView }>(
            `/api/accelerators/programs/${encodeURIComponent(id)}/similar`
        ),
    tracker: {
        list: () => call<{ opportunities: TrackerOpportunity[] }>("/api/accelerators/tracker"),
        get: (id: string) =>
            call<{ opportunity: TrackerOpportunity }>(
                `/api/accelerators/tracker/${encodeURIComponent(id)}`
            ),
        save: (input: SaveTrackerOpportunity) =>
            call<{ opportunity: TrackerOpportunity }>("/api/accelerators/tracker", {
                method: "POST",
                body: JSON.stringify(input),
            }),
        update: (id: string, patch: UpdateTrackerOpportunity) =>
            call<{ opportunity: TrackerOpportunity }>(
                `/api/accelerators/tracker/${encodeURIComponent(id)}`,
                { method: "PATCH", body: JSON.stringify(patch) }
            ),
        remove: (id: string) =>
            call<{ deleted: true }>(`/api/accelerators/tracker/${encodeURIComponent(id)}`, {
                method: "DELETE",
            }),
        addTask: (id: string, input: CreateTrackerTask) =>
            call<{ task: TrackerTask }>(
                `/api/accelerators/tracker/${encodeURIComponent(id)}/tasks`,
                {
                    method: "POST",
                    body: JSON.stringify(input),
                }
            ),
        updateTask: (id: string, taskId: string, patch: UpdateTrackerTask) =>
            call<{ task: TrackerTask }>(
                `/api/accelerators/tracker/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`,
                { method: "PATCH", body: JSON.stringify(patch) }
            ),
        removeTask: (id: string, taskId: string) =>
            call<{ deleted: true }>(
                `/api/accelerators/tracker/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`,
                { method: "DELETE" }
            ),
    },
};
