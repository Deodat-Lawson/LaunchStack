/** History supplies investigation clues, never additional fact citations or action commands. */
import type { GenerationInput } from "./contract-v1";
import type { PreviousVantageContext, PreviousVantageTopic } from "./previous-context-v1";
import { previousActionStateFingerprint } from "./previous-context-v1";
import type { CommitmentDto } from "./types";

export function usablePreviousVantage(input: GenerationInput): PreviousVantageContext | null {
    const history = input.previousVantageContext;
    const start = Date.parse(input.reportPeriod.weekStart + "T12:00:00Z");
    if (
        !history ||
        history.contractVersion !== "previous-vantage/v1" ||
        history.trust !== "untrusted-history" ||
        !Number.isFinite(start) ||
        history.weekStart !== new Date(start - 7 * 86400000).toISOString().slice(0, 10) ||
        (history.generatedAt !== null &&
            (!Number.isFinite(Date.parse(history.generatedAt)) ||
                Date.parse(history.generatedAt) > Date.parse(input.reportPeriod.asOf)))
    )
        return null;
    return history;
}

const generic = new Set(
    "about after again before check clarify could current evidence historical issue learn next previous progress question record report review should source still suggested synthetic task test their there these this using valuable whether which with would".split(
        " "
    )
);
const terms = (value: string) =>
    new Set(
        (value.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])
            .filter(word => !generic.has(word))
            .slice(0, 160)
    );

/** Lexical association only: it does not establish relevance, completion, or causation. */
export function matchingPreviousTopic(
    input: GenerationInput,
    currentText: string,
    currentRefs: readonly string[] = []
): PreviousVantageTopic | undefined {
    const history = usablePreviousVantage(input);
    if (!history) return;
    const current = terms(currentText);
    return history.topics.find(topic => {
        if (
            topic.originalRefs.some(
                source => source.status === "available" && currentRefs.includes(source.ref)
            ) ||
            topic.reportedActions.some(action => currentRefs.includes(`cm:${action.id}`))
        )
            return true;
        const clue = terms(
            `${topic.title} ${topic.question} ${topic.interpretation} ${topic.suggestedNextStep} ${topic.historicalClaims?.join(" ") ?? ""}`
        );
        return [...clue].filter(term => current.has(term)).length >= 2;
    });
}

/** An unchanged carry-forward record is not new progress evidence or a reason to repeat work. */
export function unchangedHistoricalAction(input: GenerationInput, current: CommitmentDto): boolean {
    // A resolution inside the current reporting period is a current record event,
    // even when history assembly has already read that latest linked action state.
    if (current.status !== "open" || current.resolvedAt !== null) return false;
    const history = usablePreviousVantage(input);
    const previous = history?.topics
        .flatMap(topic => topic.reportedActions)
        .find(action => action.id === current.id);
    if (!previous)
        // Bounded/masked topic projection must not revive its old linked work.
        // This only suppresses an automatic recommendation; it asserts no progress state.
        return Boolean(
            history &&
                (current.agendaId === history.reportId ||
                    history.topics.some(topic => topic.topicId === current.topicId))
        );
    if (previous.stateVersion)
        return previous.stateVersion === previousActionStateFingerprint(current);
    return (
        previous.title === current.title &&
        previous.owner === current.owner &&
        previous.dueOn === current.dueOn &&
        previous.test === current.test &&
        previous.status === current.status &&
        previous.outcome === current.outcome &&
        previous.resolvedAt === current.resolvedAt
    );
}
