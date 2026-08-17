export type ClientDeletionStatus =
    | "queued"
    | "completed"
    | "partial"
    | "manual_review"
    | "quarantined";

export interface DeletionStatusResponse {
    success?: boolean;
    status?: ClientDeletionStatus;
    deletionRequested?: boolean;
    requestId?: number;
    message?: string;
    error?: string;
}

export type DeletionPollResult =
    | { kind: "completed"; status: "completed"; payload: DeletionStatusResponse }
    | {
          kind: "terminal_failure";
          status: "partial" | "manual_review" | "quarantined";
          payload: DeletionStatusResponse;
      }
    | { kind: "timed_out"; status: "queued"; payload?: DeletionStatusResponse };

function wait(ms: number): Promise<void> {
    return new Promise(resolve => {
        window.setTimeout(resolve, ms);
    });
}

export async function pollDocumentDeletion(
    documentId: number,
    options: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<DeletionPollResult> {
    const intervalMs = options.intervalMs ?? 1000;
    const timeoutMs = options.timeoutMs ?? 60_000;
    const deadline = Date.now() + timeoutMs;
    let lastPayload: DeletionStatusResponse | undefined;

    while (Date.now() <= deadline) {
        const response = await fetch(`/api/documents/${documentId}/deletion-status`);
        const payload = (await response.json().catch(() => ({}))) as DeletionStatusResponse;
        lastPayload = payload;

        if (!response.ok) {
            throw new Error(payload.error ?? `Failed to read deletion status (${response.status})`);
        }
        if (payload.deletionRequested === false || !payload.status) {
            throw new Error("Deletion status is unavailable.");
        }
        if (payload.status === "completed") {
            return { kind: "completed", status: "completed", payload };
        }
        if (
            payload.status === "partial" ||
            payload.status === "manual_review" ||
            payload.status === "quarantined"
        ) {
            return {
                kind: "terminal_failure",
                status: payload.status,
                payload,
            };
        }

        if (Date.now() >= deadline) break;
        await wait(intervalMs);
    }

    return { kind: "timed_out", status: "queued", payload: lastPayload };
}
