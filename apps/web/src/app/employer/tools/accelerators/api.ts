import type { HomeResponse, ProgramView, RunView } from "@launchstack/pipelines/accelerators/types";

import type { Copy } from "~/i18n/copy";

export type {
    HomeResponse,
    ProgramCycle,
    ProgramView,
    SourcedNarrative,
} from "@launchstack/pipelines/accelerators/types";

export type AcceleratorRunView = RunView & { errorCopy?: Copy };
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
    home: () => call<HomeResponse>("/api/accelerators"),
    program: (id: string) =>
        call<{ program: ProgramView }>(`/api/accelerators/programs/${encodeURIComponent(id)}`),
    match: () =>
        call<{ run: AcceleratorRunView }>("/api/accelerators/match", {
            method: "POST",
            body: JSON.stringify({}),
        }),
    run: (id: string) =>
        call<{ run: AcceleratorRunView }>(`/api/accelerators/runs/${encodeURIComponent(id)}`),
};
