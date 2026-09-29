/**
 * Meeting phases — the "workflow" inside a meeting.
 *
 * A phase is a named stretch of turns with its own goal and, optionally, its
 * own set of speakers: *diverge* with everyone, *critique* with the sceptic,
 * *converge* with the chair. Phases are a pure function of the turn index so a
 * meeting replays identically from its log, exactly like the turn policies —
 * nothing here reads the clock or the transcript.
 *
 * A meeting without phases behaves as it always did: every participant is
 * eligible on every turn and the objective is the only goal.
 */

import type { AgentPersona, MeetingPhase } from "./types";

export interface PhasePosition {
    /** Zero-based index into `config.phases`. */
    index: number;
    phase: MeetingPhase;
    /** Turn index at which this phase began. */
    startTurn: number;
    /** Zero-based turn offset within the phase. */
    offset: number;
    /** True when this is the last declared phase. */
    last: boolean;
}

/** Total turns the declared phases account for. */
export function phasedTurnCount(phases: readonly MeetingPhase[] | undefined): number {
    if (!phases) return 0;
    return phases.reduce((sum, phase) => sum + Math.max(1, Math.floor(phase.turns)), 0);
}

/**
 * The phase in force at `turnIndex`, or null when the meeting has no phases.
 * Turns past the last phase stay in the last phase: a meeting whose turn cap
 * exceeds its plan keeps working the closing goal rather than losing one.
 */
export function phaseAt(
    phases: readonly MeetingPhase[] | undefined,
    turnIndex: number
): PhasePosition | null {
    if (!phases || phases.length === 0) return null;
    let start = 0;
    for (let index = 0; index < phases.length; index++) {
        const phase = phases[index]!;
        const turns = Math.max(1, Math.floor(phase.turns));
        const last = index === phases.length - 1;
        if (turnIndex < start + turns || last) {
            return { index, phase, startTurn: start, offset: turnIndex - start, last };
        }
        start += turns;
    }
    return null;
}

/**
 * Who may speak in a phase. Speaker ids that are not in the room are ignored;
 * a phase that names nobody in the room falls back to everyone rather than
 * stalling the meeting with no eligible speaker.
 */
export function phaseParticipants(
    participants: readonly AgentPersona[],
    phase: MeetingPhase | null | undefined
): AgentPersona[] {
    if (!phase?.speakerIds || phase.speakerIds.length === 0) return [...participants];
    const allowed = new Set(phase.speakerIds);
    const subset = participants.filter(p => allowed.has(p.id));
    return subset.length > 0 ? subset : [...participants];
}

/** Validates a phase plan the way the API and the dialog both need to. */
export function phasePlanProblems(
    phases: readonly MeetingPhase[] | undefined,
    participants: readonly Pick<AgentPersona, "id">[]
): string[] {
    if (!phases || phases.length === 0) return [];
    const problems: string[] = [];
    const roster = new Set(participants.map(p => p.id));
    phases.forEach((phase, index) => {
        const label = phase.title?.trim() ? `"${phase.title.trim()}"` : `Phase ${index + 1}`;
        if (!phase.title?.trim()) problems.push(`Phase ${index + 1} needs a title.`);
        if (!Number.isFinite(phase.turns) || phase.turns < 1) {
            problems.push(`${label} needs at least one turn.`);
        }
        const speakers = phase.speakerIds ?? [];
        if (speakers.length > 0 && !speakers.some(id => roster.has(id))) {
            problems.push(`${label} names speakers who are not in the room.`);
        }
    });
    return problems;
}
