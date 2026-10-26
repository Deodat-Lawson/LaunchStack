import type {
    AcceleratorApplication,
    AcceleratorSection,
    AnswerPatch,
    ApplyEdit,
    EditSuggestionRequest,
    HomeResponse,
    ProgramView,
    RunView,
} from "@launchstack/pipelines/accelerators/types";

export type {
    AcceleratorApplication,
    AcceleratorSection,
    ApplyEdit,
    EditSuggestion,
    EditSuggestionRequest,
    FormField,
    HomeResponse,
    ProgramCycle,
    ProgramForm,
    ProgramSource,
    ProgramView,
    SourcedNarrative,
} from "@launchstack/pipelines/accelerators/types";

export type AcceleratorRunView = RunView;
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

function send<T>(url: string, body: unknown, method = "POST"): Promise<T> {
    return call<T>(url, { method, body: JSON.stringify(body) });
}

function sectionPath(applicationId: string, sectionId: string): string {
    return `/api/accelerators/applications/${encodeURIComponent(applicationId)}/sections/${encodeURIComponent(sectionId)}`;
}

export const acceleratorsApi = {
    home: () => call<HomeResponse>("/api/accelerators"),
    program: (id: string) =>
        call<{ program: ProgramView }>(`/api/accelerators/programs/${encodeURIComponent(id)}`),
    match: () => send<{ run: AcceleratorRunView }>("/api/accelerators/match", {}),
    start: (programId: string, cycleId: string) =>
        send<{ application: AcceleratorApplication }>("/api/accelerators/applications", {
            programId,
            cycleId,
        }),
    application: (id: string) =>
        call<{ application: AcceleratorApplication }>(
            `/api/accelerators/applications/${encodeURIComponent(id)}`
        ),
    save: (applicationId: string, sectionId: string, patch: AnswerPatch) =>
        send<{ section: AcceleratorSection }>(
            sectionPath(applicationId, sectionId),
            patch,
            "PATCH"
        ),
    draft: (applicationId: string, sectionId: string, expectedRevision: number) =>
        send<{ run: AcceleratorRunView }>(`${sectionPath(applicationId, sectionId)}/draft`, {
            expectedRevision,
        }),
    suggest: (applicationId: string, sectionId: string, request: EditSuggestionRequest) =>
        send<{ run: AcceleratorRunView }>(
            `${sectionPath(applicationId, sectionId)}/suggest`,
            request
        ),
    apply: (applicationId: string, sectionId: string, edit: ApplyEdit) =>
        send<{ section: AcceleratorSection }>(
            `${sectionPath(applicationId, sectionId)}/apply`,
            edit
        ),
    run: (id: string) =>
        call<{ run: AcceleratorRunView }>(`/api/accelerators/runs/${encodeURIComponent(id)}`),
};
