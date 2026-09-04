/** The compliance-screen tool's environment reads — the only module here that touches process.env. */
export function getOpenSanctionsApiUrl(): string | undefined {
    return process.env.OPENSANCTIONS_API_URL;
}

export function getOpenSanctionsApiKey(): string | undefined {
    return process.env.OPENSANCTIONS_API_KEY;
}
