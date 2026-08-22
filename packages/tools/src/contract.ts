/**
 * The tool contract — the shape every tool in this package shares.
 *
 * A tool entry point takes zod-typed input, does its work in the caller's
 * process, and either succeeds, throws a typed ToolError, or returns an
 * explicitly declared degraded result. Tools never console.warn-and-continue
 * on their own: what a failure *means* is the caller's policy, declared at the
 * call site.
 *
 * ToolError matches StatusCarryingError from apps/web/src/server/api/responses
 * structurally ({ code, status }) so the shared route contract can map tool
 * failures to HTTP responses without importing this package's error types.
 */

export interface ToolRunContext {
    /** Cancellation, threaded from the route's request.signal. */
    signal?: AbortSignal;
    /** Progress events for hosts that stream them (the SSE pipeline route). */
    onProgress?: (event: ToolProgressEvent) => void;
    /**
     * Durable-host seam (the DocIngestionTool precedent): identity in a plain
     * host, `step.run` under Inngest so completed steps replay for free.
     */
    runStep?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}

export type ToolProgressEvent =
    | { type: "step_start"; step: string; label?: string }
    | {
          type: "step_complete";
          step: string;
          durationMs: number;
          detail?: string;
          status?: "completed" | "skipped" | "failed";
      }
    | { type: "step_data"; step: string; data: Record<string, unknown> };

export interface ToolProvenance {
    /** Tool (and entry point) that produced this result, e.g. "company-context.identity". */
    tool: string;
    durationMs: number;
    /** Concrete model id, when an LLM call was involved. */
    modelId?: string;
    /** Version of the prompt that produced the output, when an LLM call was involved. */
    promptVersion?: string;
}

export interface ToolResult<T> {
    data: T;
    provenance: ToolProvenance;
}

export class ToolError extends Error {
    readonly code: string;
    readonly status: number;
    readonly retryable: boolean;

    constructor(args: { code: string; message: string; status?: number; retryable?: boolean }) {
        super(args.message);
        this.name = "ToolError";
        this.code = args.code;
        this.status = args.status ?? 500;
        this.retryable = args.retryable ?? false;
    }
}

/** Wrap a tool entry point: times the call and stamps provenance. */
export async function runTool<T>(
    tool: string,
    fn: () => Promise<{ value: T; modelId?: string; promptVersion?: string }>
): Promise<ToolResult<T>> {
    const start = Date.now();
    const { value, modelId, promptVersion } = await fn();
    return {
        data: value,
        provenance: { tool, durationMs: Date.now() - start, modelId, promptVersion },
    };
}
