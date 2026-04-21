/**
 * Module-level RagPort slot. createEngine calls configureRag with the host's
 * port (when one is supplied); features reach it through getRag() /
 * getRagOrNull().
 *
 * `ragSearchSafe` is the convenience wrapper: it returns an empty result
 * array when no port is registered instead of throwing, so pipelines that
 * run against a non-RAG deployment silently skip retrieval.
 */

import type {
  RagPort,
  CompanySearchOptions,
  RagSearchResult,
} from "./types";

let _port: RagPort | null = null;

export function configureRag(port: RagPort): void {
  _port = port;
}

export function getRag(): RagPort {
  if (!_port) {
    throw new Error(
      "[@launchstack/core/rag] No RagPort registered. Pass `rag.port` to createEngine, or call configureRag(port) directly.",
    );
  }
  return _port;
}

export function getRagOrNull(): RagPort | null {
  return _port;
}

export async function ragCompanySearchSafe(
  query: string,
  options: CompanySearchOptions,
): Promise<RagSearchResult[]> {
  const port = _port;
  if (!port) return [];
  try {
    return await port.companyEnsembleSearch(query, options);
  } catch (err) {
    console.warn("[@launchstack/core/rag] companyEnsembleSearch failed:", err);
    return [];
  }
}
