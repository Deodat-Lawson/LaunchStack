import { createHash, randomUUID } from "node:crypto";

export interface ContinuityActor {
    companyId: string;
    userId: string;
}

export interface ContinuitySource {
    id: string;
    contentVersion: string;
    contentHash: string;
}

/** Repository adapters must derive this projection from authorized server-side rows. */
export interface RecordedContinuityRow {
    kind: "human_recorded_decision" | "action_reported_status";
    id: string;
    companyId: string;
    ownerId: string;
    shared: boolean;
    reportId: string | null;
    contentVersion: number;
    recordCreatorUserId: string;
    /** Null when the existing row does not retain the author of its latest update. */
    authorUserId: string | null;
    recordedAt: string;
    sources: ContinuitySource[];
    content: {
        title: string;
        decision: string | null;
        status: "open" | "done" | "missed" | "dropped" | null;
        outcome: string | null;
        resolvedAt: string | null;
        owner: string | null;
        dueOn: string | null;
        test: string | null;
    };
}

export interface ContinuityObservation {
    readonly id: string;
    readonly schema: "vantage-recorded-continuity/v1";
    readonly observedAt: string;
    readonly contentHash: string;
    readonly record: Readonly<RecordedContinuityRow>;
    readonly executionVerification: "unknown";
}

export interface RecordedContinuityDependencies {
    currentActor(): Promise<ContinuityActor>;
    /** Must check current membership and read through the authorized repository. */
    readRecord(
        actor: ContinuityActor,
        kind: RecordedContinuityRow["kind"],
        id: string
    ): Promise<RecordedContinuityRow | null>;
    /** Must enforce current report ACL and its frozen underlying dependencies. */
    authorizeReport(actor: ContinuityActor, reportId: string): Promise<boolean>;
    /** Must enforce current company/document ACL for this exact source identity. */
    authorizeSource(actor: ContinuityActor, source: ContinuitySource): Promise<boolean>;
    now(): Date;
}

export interface ContinuityLimits {
    maxObservations: number;
    maxRecordBytes: number;
    maxAggregateBytes: number;
}

export const DEFAULT_CONTINUITY_LIMITS: Readonly<ContinuityLimits> = Object.freeze({
    maxObservations: 100,
    maxRecordBytes: 64 * 1024,
    maxAggregateBytes: 1024 * 1024,
});

/** ISO calendar timestamp at millisecond precision with an explicit UTC offset. */
function timestamp(value: string): number {
    const parts =
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
            value
        );
    if (!parts) return NaN;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, offset] = parts;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > daysInMonth[month - 1]! ||
        Number(hourText) > 23 ||
        Number(minuteText) > 59 ||
        Number(secondText) > 59 ||
        (offset !== "Z" && (Number(offset!.slice(1, 3)) > 23 || Number(offset!.slice(4, 6)) > 59))
    )
        return NaN;
    return Date.parse(value);
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function freeze<T>(value: T): T {
    if (value && typeof value === "object") {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
    return value;
}

/** Bounded process-local prototype. Captures survive row edits within this instance only. */
export function createRecordedContinuity(
    dependencies: RecordedContinuityDependencies,
    configuredLimits: Partial<ContinuityLimits> = {}
) {
    const limits = { ...DEFAULT_CONTINUITY_LIMITS, ...configuredLimits };
    if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 1))
        throw new Error("continuity_invalid_limits");
    let aggregateBytes = 0;
    const observations = new Map<string, ContinuityObservation>();

    async function authorize(actor: ContinuityActor, row: RecordedContinuityRow) {
        if (row.companyId !== actor.companyId || (!row.shared && row.ownerId !== actor.userId))
            throw new Error("continuity_access_denied");
        if (row.reportId && !(await dependencies.authorizeReport(actor, row.reportId)))
            throw new Error("continuity_access_denied");
        for (const source of row.sources) {
            if (!(await dependencies.authorizeSource(actor, source)))
                throw new Error("continuity_access_denied");
        }
    }

    return {
        async capture(kind: RecordedContinuityRow["kind"], id: string) {
            const actor = await dependencies.currentActor();
            const row = await dependencies.readRecord(actor, kind, id);
            if (!row || row.id !== id || row.kind !== kind)
                throw new Error("continuity_record_unavailable");
            // Detach repository-owned mutable objects before checking or retaining their contents.
            const record: RecordedContinuityRow = structuredClone(row);
            await authorize(actor, record);
            const clock = dependencies.now();
            if (!(clock instanceof Date) || !Number.isFinite(clock.getTime()))
                throw new Error("continuity_invalid_clock");
            const observedAt = clock.toISOString();
            if (!Number.isFinite(timestamp(observedAt)))
                throw new Error("continuity_invalid_clock");
            const recordedTime = timestamp(record.recordedAt);
            if (
                !Number.isSafeInteger(record.contentVersion) ||
                record.contentVersion < 1 ||
                !Number.isFinite(recordedTime) ||
                recordedTime > clock.getTime()
            )
                throw new Error("continuity_invalid_record");
            if (Buffer.byteLength(JSON.stringify(record), "utf8") > limits.maxRecordBytes)
                throw new Error("continuity_quota_exhausted");
            const observation = freeze<ContinuityObservation>({
                id: randomUUID(),
                schema: "vantage-recorded-continuity/v1",
                observedAt,
                contentHash: digest(record),
                record,
                executionVerification: "unknown",
            });
            const observationBytes = Buffer.byteLength(JSON.stringify(observation), "utf8");
            // No awaits between quota admission and insertion, including concurrent capture calls.
            if (
                observations.size >= limits.maxObservations ||
                observationBytes > limits.maxAggregateBytes - aggregateBytes
            )
                throw new Error("continuity_quota_exhausted");
            observations.set(observation.id, observation);
            aggregateBytes += observationBytes;
            return observation;
        },

        async read(id: string, expectedHash: string, cutoff: string) {
            const observation = observations.get(id);
            if (
                !observation ||
                expectedHash !== observation.contentHash ||
                digest(observation.record) !== observation.contentHash
            )
                throw new Error("continuity_capture_mismatch");
            const actor = await dependencies.currentActor();
            const captured = observation.record;
            const current = await dependencies.readRecord(actor, captured.kind, captured.id);
            if (
                !current ||
                current.id !== captured.id ||
                current.kind !== captured.kind ||
                current.companyId !== captured.companyId ||
                current.ownerId !== captured.ownerId ||
                current.reportId !== captured.reportId ||
                current.recordCreatorUserId !== captured.recordCreatorUserId
            )
                throw new Error("continuity_record_unavailable");
            await authorize(actor, current);
            await authorize(actor, captured);
            const cutoffTime = timestamp(cutoff);
            if (!Number.isFinite(cutoffTime)) throw new Error("continuity_invalid_cutoff");
            if (cutoffTime < timestamp(observation.observedAt))
                return { state: "unknown_historical_state" as const };
            return { state: "observed_record" as const, observation };
        },
    };
}
