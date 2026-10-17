import { VantageError, type GenerationPort } from "@launchstack/pipelines/vantage";

let port: GenerationPort | undefined;
/** The host/TL connects the bounded adapter supplied by Member B at server setup. */
export function installVantageGenerationPort(adapter: GenerationPort): void {
    port = adapter;
}
export function getVantageGenerationPort(): GenerationPort {
    if (!port)
        throw new VantageError(
            "The generation adapter has not been connected.",
            503,
            "generation_unavailable"
        );
    return port;
}
