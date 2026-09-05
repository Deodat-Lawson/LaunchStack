/**
 * Module-level RagPort slot. createEngine calls configureRag with the host's
 * port (when one is supplied); features reach it through getRag() /
 * getRagOrNull().
 *
 * `ragSearchSafe` is the convenience wrapper: it returns an empty result
 * array when no port is registered instead of throwing, so pipelines that
 * run against a non-RAG deployment silently skip retrieval.
 */

import type { RagPort, CompanySearchOptions, RagSearchResult } from "./types";
import { createSlot } from "@launchstack/runtime";

const portSlot = createSlot<RagPort>("rag/port");

export function configureRag(port: RagPort): void {
    portSlot.set(port);
}

export function getRag(): RagPort {
    const port = portSlot.get();
    if (!port) {
        throw new Error(
            "[@launchstack/retrieval] No RagPort registered. Pass `rag.port` to createEngine, or call configureRag(port) directly."
        );
    }
    return port;
}

export function getRagOrNull(): RagPort | null {
    return portSlot.get() ?? null;
}

/**
 * Company search through the port, empty when no port is registered.
 * `options.scope` is the caller's document scope; hosts must apply it to
 * every leg. Omitting it searches the whole company corpus, which is only
 * right for workspace-level callers (pipelines), never for a person.
 *
 * @deprecated There is no company-wide search: resolve the readable document
 * ids and use the multi-document search. Kept for workspace-level callers.
 */
export async function ragCompanySearchSafe(
    query: string,
    options: CompanySearchOptions
): Promise<RagSearchResult[]> {
    const port = portSlot.get();
    if (!port) return [];
    try {
        return await port.companyEnsembleSearch(query, options);
    } catch (err) {
        console.warn("[@launchstack/retrieval] companyEnsembleSearch failed:", err);
        return [];
    }
}
