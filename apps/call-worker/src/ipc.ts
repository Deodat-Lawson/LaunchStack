import { z } from "zod";

export const WorkerControlSchema = z
    .object({
        type: z.enum(["keep_recording", "call_ended_signal", "shutdown"]),
    })
    .strict();

export type WorkerControl = z.infer<typeof WorkerControlSchema>;
export type WorkerState = "idle" | "starting" | "capturing" | "paused" | "stopping";

export interface CaptureProgress {
    channels: { microphone: boolean; system: boolean };
    segments: number;
    lastSegmentAt?: string;
}

export type AutoStopMessage =
    | { type: "auto_stop_pending"; reason: "silence" | "call_ended"; stopsAt: string }
    | { type: "auto_stop_cancelled" };

export type WorkerMessage =
    | AutoStopMessage
    | ({
          type: "state";
          state: WorkerState;
          callId?: string;
          title?: string;
          startedAt?: string;
      } & CaptureProgress);

export function emitWorkerMessage(message: WorkerMessage): void {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

export function logWorkerEvent(event: string, fields: Record<string, unknown> = {}): void {
    process.stderr.write(
        `${JSON.stringify({ event, ...fields, observedAt: new Date().toISOString() })}\n`
    );
}
