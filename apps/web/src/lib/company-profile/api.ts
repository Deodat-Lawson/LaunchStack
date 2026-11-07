/**
 * Browser client for the company profile routes. Both screens that show the
 * profile call these; the routes are in `app/api/company/profile`.
 */
import type { CompanyProfileDto, ProfileFactPatch, ProfileSourcePatch } from "./dto";

export class CompanyProfileApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        /**
         * True when the message is this client's own "Request failed" rather
         * than the server's sentence, so a screen can say it in the reader's
         * language instead.
         */
        readonly generated = false
    ) {
        super(message);
        this.name = "CompanyProfileApiError";
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
        throw new CompanyProfileApiError(
            server ?? `Request failed (${response.status})`,
            response.status,
            server === null
        );
    }
    return body as T;
}

type ProfileResponse = { profile: CompanyProfileDto };

export const companyProfileApi = {
    get: () => call<ProfileResponse>("/api/company/profile"),
    rebuild: () => call<ProfileResponse>("/api/company/profile", { method: "POST" }),
    patchFact: (patch: ProfileFactPatch) =>
        call<ProfileResponse>("/api/company/profile/facts", {
            method: "PATCH",
            body: JSON.stringify(patch),
        }),
    setSource: (documentId: number, patch: ProfileSourcePatch) =>
        call<ProfileResponse>(`/api/company/profile/sources/${documentId}`, {
            method: "PATCH",
            body: JSON.stringify(patch),
        }),
};
