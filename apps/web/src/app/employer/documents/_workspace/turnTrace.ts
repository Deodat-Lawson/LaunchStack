import type { ChatStep } from "~/lib/chat-stream";
import { MAX_TURN_STEPS, type ChatTurnStep } from "~/lib/chat-turns";

/**
 * Upsert a streamed step by id and stamp when it started and finished, in ms
 * from the send. A step first seen as done started and ended at once.
 */
export function applyStep(
    steps: readonly ChatTurnStep[] | undefined,
    step: ChatStep,
    atMs: number
): ChatTurnStep[] {
    const list = steps ?? [];
    const at = Math.max(0, Math.round(atMs));
    const index = list.findIndex(existing => existing.id === step.id);
    const previous = index >= 0 ? list[index] : undefined;
    const next: ChatTurnStep = {
        id: step.id,
        label: step.label,
        state: step.state,
        ...(step.detail ? { detail: step.detail } : {}),
        startMs: previous?.startMs ?? at,
        ...(step.state === "done" ? { endMs: previous?.endMs ?? at } : {}),
    };
    if (previous) return list.map((existing, i) => (i === index ? next : existing));
    return list.length >= MAX_TURN_STEPS ? [...list] : [...list, next];
}

/** A turn that stopped or failed leaves no step running; each one keeps its last label. */
export function settleSteps(
    steps: readonly ChatTurnStep[] | undefined,
    atMs: number
): ChatTurnStep[] | undefined {
    if (!steps?.length) return steps ? [...steps] : undefined;
    const at = Math.max(0, Math.round(atMs));
    return steps.map(step => (step.endMs === undefined ? { ...step, endMs: at } : step));
}

/** The step to name while the answer works: the newest one still running. */
export function currentStep(steps: readonly ChatTurnStep[] | undefined): ChatTurnStep | undefined {
    return [...(steps ?? [])].reverse().find(step => step.state === "active");
}

/** "0.4s", "3.2s", "12s", "1m 05s". */
export function formatDuration(ms: number): string {
    const tenths = Math.round(Math.max(0, ms) / 100);
    if (tenths < 100) return `${(tenths / 10).toFixed(1)}s`;
    const whole = Math.round(ms / 1000);
    if (whole < 60) return `${whole}s`;
    return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

/** "Thought for 4s": whole seconds, never "0s". */
export function formatThought(ms: number): string {
    const seconds = Math.max(1, Math.round(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
