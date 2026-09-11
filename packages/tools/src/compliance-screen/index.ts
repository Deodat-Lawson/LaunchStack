import { getOpenSanctionsApiKey, getOpenSanctionsApiUrl } from "./config";
import type { ComplianceScreenProvider, ScreenFlag, ScreenQuery, ScreenResult } from "./types";
import { createYenteProvider } from "./yente";

export * from "./types";
export { createYenteProvider, type YenteProviderOptions } from "./yente";

/** A provider over a fixed flag table — tests and demos. */
export function createStaticComplianceProvider(
    flagsByName: Readonly<Record<string, readonly ScreenFlag[]>>,
    name = "static"
): ComplianceScreenProvider {
    return {
        name,
        async screen(query: ScreenQuery): Promise<ScreenResult> {
            const key = query.name.trim().toLowerCase();
            const hit = Object.entries(flagsByName).find(([n]) => n.trim().toLowerCase() === key);
            return {
                provider: name,
                checkedAt: new Date().toISOString(),
                flags: [...(hit?.[1] ?? [])],
            };
        },
    };
}

/** The configured provider (OPENSANCTIONS_API_URL), or null when screening is off. */
export function resolveComplianceProvider(): ComplianceScreenProvider | null {
    const baseUrl = getOpenSanctionsApiUrl();
    if (!baseUrl) return null;
    return createYenteProvider({ baseUrl, apiKey: getOpenSanctionsApiKey() });
}

export function isComplianceScreenConfigured(): boolean {
    return Boolean(getOpenSanctionsApiUrl());
}
