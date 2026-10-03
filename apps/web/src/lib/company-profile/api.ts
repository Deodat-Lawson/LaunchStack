/**
 * Browser client for the company profile routes. Both screens that show the
 * profile call these; the routes are in `app/api/company/profile`.
 */
import type { CompanyProfileDto, ProfileFactPatch, ProfileSourcePatch } from "./dto";

export class CompanyProfileApiError extends Error {
    constructor(
        message: string,
        readonly status: number
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
        const message =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
                ? body.error
                : `Request failed (${response.status})`;
        throw new CompanyProfileApiError(message, response.status);
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
