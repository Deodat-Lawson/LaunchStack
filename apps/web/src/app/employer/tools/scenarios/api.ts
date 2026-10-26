/**
 * The Scenarios client for `/api/scenarios/**`. Every shape comes from the
 * wire contract (`~/lib/scenarios/types`), so a field the server adds shows up
 * here without a second definition.
 */
import type {
    CreateScenarioInput,
    ScenarioDetail,
    ScenarioEstimate,
    ScenarioInjection,
    ScenarioInterview,
    ScenarioSourceOptions,
    ScenarioSummary,
} from "~/lib/scenarios/types";

export class ScenariosApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly body: unknown,
        /**
         * True when the message is this client's own "Request failed" rather
         * than the server's sentence, so a screen can say it in the reader's
         * language instead (`useErrorText` in ~/lib/tools/errorText).
         */
        readonly generated = false
    ) {
        super(message);
        this.name = "ScenariosApiError";
    }

    /** The server's machine-readable reason, e.g. "insufficient_credits". */
    get code(): string | null {
        const body = this.body;
        return body && typeof body === "object" && "code" in body && typeof body.code === "string"
            ? body.code
            : null;
    }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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
        const server =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
                ? body.error
                : null;
        throw new ScenariosApiError(
            server ?? `Request failed (${response.status})`,
            response.status,
            body,
            server === null
        );
    }
    return body as T;
}

const send = <T>(url: string, payload: unknown, method = "POST") =>
    call<T>(url, { method, body: JSON.stringify(payload) });

export const scenariosApi = {
    list: () => call<{ runs: ScenarioSummary[] }>("/api/scenarios"),
    sources: () => call<ScenarioSourceOptions>("/api/scenarios/sources"),
    estimate: (input: { agents: number; rounds: number }) =>
        send<ScenarioEstimate>("/api/scenarios/estimate", input),
    create: (input: CreateScenarioInput) => send<{ run: ScenarioSummary }>("/api/scenarios", input),
    get: (id: number) => call<{ run: ScenarioDetail }>(`/api/scenarios/${id}`),
    patch: (id: number, patch: { title?: string; shared?: boolean }) =>
        send<{ run: ScenarioSummary }>(`/api/scenarios/${id}`, patch, "PATCH"),
    remove: (id: number) => call<{ ok: true }>(`/api/scenarios/${id}`, { method: "DELETE" }),
    cancel: (id: number) =>
        call<{ run: ScenarioSummary }>(`/api/scenarios/${id}/cancel`, { method: "POST" }),
    addEvent: (id: number, text: string) =>
        send<{ injection: ScenarioInjection }>(`/api/scenarios/${id}/events`, { text }),
    interviews: (id: number) =>
        call<{ interviews: ScenarioInterview[] }>(`/api/scenarios/${id}/interviews`),
    ask: (id: number, agentId: string, question: string) =>
        send<{ interview: ScenarioInterview }>(`/api/scenarios/${id}/interviews`, {
            agentId,
            question,
        }),
};

/** The person id the contract uses for questions about the whole run. */
export const ANALYST_ID = "analyst";
