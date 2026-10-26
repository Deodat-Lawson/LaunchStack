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

/** A duration as a catalogue spells it: seconds alone, or minutes and seconds. */
export interface DurationParts {
    minutes?: number;
    seconds: string;
}

function split(wholeSeconds: number): DurationParts {
    return wholeSeconds < 60
        ? { seconds: String(wholeSeconds) }
        : {
              minutes: Math.floor(wholeSeconds / 60),
              seconds: String(wholeSeconds % 60).padStart(2, "0"),
          };
}

/** A step's time: tenths under ten seconds ("0.9"), whole seconds after, then minutes. */
export function durationParts(ms: number): DurationParts {
    const tenths = Math.round(Math.max(0, ms) / 100);
    if (tenths < 100) return { seconds: (tenths / 10).toFixed(1) };
    return split(Math.round(ms / 1000));
}

/** The headline's time ("Thought for 4s"): whole seconds, never "0". */
export function thoughtParts(ms: number): DurationParts {
    return split(Math.max(1, Math.round(ms / 1000)));
}
