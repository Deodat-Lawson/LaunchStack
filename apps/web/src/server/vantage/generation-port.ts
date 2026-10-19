import type { GenerationPort } from "@launchstack/pipelines/vantage";
import { generateWeeklyAgendaV1 } from "@launchstack/pipelines/vantage/generation-v1";

// Bind the adapter in the service's dependency path so every server route gets it.
let port: GenerationPort = generateWeeklyAgendaV1;
/** Hosts and integration tests can explicitly replace the default adapter. */
export function installVantageGenerationPort(adapter: GenerationPort): void {
    port = adapter;
}
export function getVantageGenerationPort(): GenerationPort {
    return port;
}
