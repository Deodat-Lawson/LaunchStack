import { and, eq, getTableName, sql } from "drizzle-orm";

import {
    CALL_NOTES_CAPTURE_EVENTS,
    CALL_NOTES_DETECTED_CANDIDATE,
    CALL_NOTES_DISMISS_COMMAND,
    CALL_NOTES_ENRICHMENT_PROPOSAL,
    CALL_NOTES_FIXTURE_IDS,
    CALL_NOTES_START_COMMAND,
    type CallNotesApplicationError,
    CallNotesCommandSchema,
    CaptureEventSchema,
    CompleteEnrichmentInputSchema,
    DetectedCallCandidateSchema,
    runCallNotesVerticalTracer,
    renderEnrichedNoteProposal,
    type CallListQuery,
    type CallNotesApplication,
    type CallNotesCommand,
    type CallNotesDocumentNoteStore,
    type CallNotesIdSource,
    type CaptureEvent,
    type DetectedCallCandidate,
    type CallNoteIndex,
} from "@launchstack/pipelines/call-notes";

// Keep the integration test focused on the injected migrated database. The
// production engine eagerly imports env.ts, which is not a Jest-loadable module
// under this test transform; the adapter still uses getEngine().db by default
// when no database is supplied.
jest.mock("~/server/engine", () => ({
    getEngine: jest.fn(),
}));

import { createWebCallNotesApplication } from "~/server/call-notes/application";
import { documentNotes } from "~/server/db/schema";
import { listWorkspaceCallNoteFiles } from "~/server/call-notes/files";

import { createCallNotesTestDatabase, type CallNotesTestDatabase } from "./testDb";

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;

const RENDERED_ENRICHMENT_PROPOSAL = renderEnrichedNoteProposal(CALL_NOTES_ENRICHMENT_PROPOSAL);
const FIXED_NOW = new Date("2026-08-15T14:30:00.000Z");
const DOCUMENT_NOTES_TABLE = sql.identifier(getTableName(documentNotes));

type StartCaptureCommand = Extract<CallNotesCommand, { kind: "start_capture" }>;
type UpdateNoteCommand = Extract<CallNotesCommand, { kind: "update_note" }>;
type AcceptEnrichmentCommand = Extract<CallNotesCommand, { kind: "accept_enrichment" }>;

function parseStartCaptureCommand(input: StartCaptureCommand): StartCaptureCommand {
    const parsed = CallNotesCommandSchema.parse(input);
    if (parsed.kind !== "start_capture") {
        throw new Error("expected start_capture command");
    }
    return parsed;
}

function parseUpdateNoteCommand(input: UpdateNoteCommand): UpdateNoteCommand {
    const parsed = CallNotesCommandSchema.parse(input);
    if (parsed.kind !== "update_note") {
        throw new Error("expected update_note command");
    }
    return parsed;
}

function parseAcceptEnrichmentCommand(input: AcceptEnrichmentCommand): AcceptEnrichmentCommand {
    const parsed = CallNotesCommandSchema.parse(input);
    if (parsed.kind !== "accept_enrichment") {
        throw new Error("expected accept_enrichment command");
    }
    return parsed;
}
interface FixtureIds {
    alphaCompanyId: bigint;
    betaCompanyId: bigint;
    ownerPk: bigint;
    teammatePk: bigint;
    adminPk: bigint;
    outsiderPk: bigint;
}

interface RecordingCallNoteIndex extends CallNoteIndex {
    syncs: Array<{ companyId: string; callId: string }>;
    failNextSync(): void;
}

function returnedId(row: unknown, description: string): bigint {
    if (!row || typeof row !== "object" || !("id" in row)) {
        throw new Error(`Missing ${description} id`);
    }
    const id = row.id;
    if (typeof id !== "string" && typeof id !== "number" && typeof id !== "bigint") {
        throw new Error(`Invalid ${description} id`);
    }
    return BigInt(id);
}

async function insertCompany(testDb: CallNotesTestDatabase, name: string): Promise<bigint> {
    const rows = await testDb.db.execute(sql`
        INSERT INTO "pdr_ai_v2_company" ("name", "numberOfEmployees")
        VALUES (${name}, '5')
        RETURNING "id"
    `);
    return returnedId(rows[0], `${name} company`);
}

async function insertUser(
    testDb: CallNotesTestDatabase,
    input: { userId: string; companyId: bigint; role: string }
): Promise<bigint> {
    const rows = await testDb.db.execute(sql`
        INSERT INTO "pdr_ai_v2_users"
            ("name", "email", "userId", "company_id", "role", "status")
        VALUES
            (${input.userId}, ${`${input.userId}@example.test`}, ${input.userId},
             ${input.companyId}, ${input.role}, 'active')
        RETURNING "id"
    `);
    return returnedId(rows[0], `${input.userId} user`);
}

async function insertMembership(
    testDb: CallNotesTestDatabase,
    userPk: bigint,
    companyId: bigint,
    role: "owner" | "admin" | "editor"
): Promise<void> {
    await testDb.db.execute(sql`
        INSERT INTO "pdr_ai_v2_user_company_memberships"
            ("user_id", "company_id", "role")
        VALUES (${userPk}, ${companyId}, ${role})
    `);
}

async function insertFixtures(testDb: CallNotesTestDatabase): Promise<FixtureIds> {
    const alphaCompanyId = await insertCompany(testDb, "Alpha Call Notes");
    const betaCompanyId = await insertCompany(testDb, "Beta Call Notes");
    const ownerPk = await insertUser(testDb, {
        userId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
        companyId: alphaCompanyId,
        role: "owner",
    });
    const teammatePk = await insertUser(testDb, {
        userId: CALL_NOTES_FIXTURE_IDS.otherUserId,
        companyId: alphaCompanyId,
        role: "employee",
    });
    const adminPk = await insertUser(testDb, {
        userId: "user_admin",
        companyId: alphaCompanyId,
        role: "employer",
    });
    const outsiderPk = await insertUser(testDb, {
        userId: "user_beta_owner",
        companyId: betaCompanyId,
        role: "owner",
    });

    await insertMembership(testDb, ownerPk, alphaCompanyId, "owner");
    await insertMembership(testDb, teammatePk, alphaCompanyId, "editor");
    await insertMembership(testDb, adminPk, alphaCompanyId, "admin");
    await insertMembership(testDb, outsiderPk, betaCompanyId, "owner");

    return {
        alphaCompanyId,
        betaCompanyId,
        ownerPk,
        teammatePk,
        adminPk,
        outsiderPk,
    };
}

function createCallNoteIndex(onSync?: CallNoteIndex["sync"]): RecordingCallNoteIndex {
    const syncs: Array<{ companyId: string; callId: string }> = [];
    let failuresBeforeSync = 0;
    return {
        syncs,
        failNextSync() {
            failuresBeforeSync += 1;
        },
        async sync(input) {
            syncs.push(input);
            await onSync?.(input);
            if (failuresBeforeSync > 0) {
                failuresBeforeSync -= 1;
                throw new Error("fixture Call Note indexing failure");
            }
        },
    };
}

interface ApplicationTestOptions {
    callNoteIndex?: RecordingCallNoteIndex;
    ids?: CallNotesIdSource;
    documentNotes?: CallNotesDocumentNoteStore;
    clock?: { now(): Date };
}

function createApplication(
    testDb: Pick<CallNotesTestDatabase, "db">,
    options: ApplicationTestOptions = {}
): {
    application: CallNotesApplication;
    callNoteIndex: RecordingCallNoteIndex;
    detectedQueries: CallListQuery[];
} {
    const callNoteIndex = options.callNoteIndex ?? createCallNoteIndex();
    const detectedQueries: CallListQuery[] = [];
    const otherCandidate = DetectedCallCandidateSchema.parse({
        ...CALL_NOTES_DETECTED_CANDIDATE,
        sourceOccurrenceKey: "local-occurrence-other",
        title: "Another customer review",
    });
    const candidates: readonly DetectedCallCandidate[] = [
        CALL_NOTES_DETECTED_CANDIDATE,
        otherCandidate,
    ];
    let nextId = 0;
    const ids = options.ids ?? {
        next(prefix: string) {
            nextId += 1;
            return `${prefix}-fixture-${nextId}`;
        },
    };

    const application = createWebCallNotesApplication({
        db: testDb.db,
        callNoteIndex,
        documentNotes: options.documentNotes,
        detectedCalls: {
            async list(query) {
                detectedQueries.push(query);
                return query.companyId === CALL_NOTES_FIXTURE_IDS.companyId ? candidates : [];
            },
        },
        clock: options.clock ?? { now: () => new Date(FIXED_NOW) },
        ids,
    });

    return { application, callNoteIndex, detectedQueries };
}

async function heartbeatWorker(
    application: CallNotesApplication,
    workerId = "fixture-worker"
): Promise<void> {
    await application.pollLocalCapture({
        companyId: CALL_NOTES_FIXTURE_IDS.companyId,
        userId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
        workerId,
    });
}

async function startWithWorker(
    application: CallNotesApplication,
    command: StartCaptureCommand = CALL_NOTES_START_COMMAND
) {
    await heartbeatWorker(application);
    return application.execute(command);
}

async function expectApplicationCode(
    operation: Promise<unknown>,
    code: CallNotesApplicationError["code"]
): Promise<void> {
    await expect(operation).rejects.toMatchObject({ code });
}

async function countTranscriptSegments(testDb: CallNotesTestDatabase): Promise<number> {
    const rows = await testDb.db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM "pdr_ai_v2_call_notes_transcript_segments"
    `);
    const count = rows[0]?.count;
    return typeof count === "number" ? count : Number(count);
}

describeIfDatabase("Call Notes PostgreSQL application integration", () => {
    let testDb!: CallNotesTestDatabase;

    beforeEach(async () => {
        testDb = await createCallNotesTestDatabase();
    }, 30_000);

    afterEach(async () => {
        if (testDb) await testDb.close();
    }, 30_000);

    it("runs the real application through the shared vertical tracer and preserves durable boundaries", async () => {
        const fixtures = await insertFixtures(testDb);
        expect(fixtures.alphaCompanyId).toBe(1n);
        expect(fixtures.betaCompanyId).toBe(2n);

        const { application, callNoteIndex, detectedQueries } = createApplication(testDb);
        const detectedBefore = await application.listDetectedCalls({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            limit: 50,
        });
        expect(detectedBefore.map(candidate => candidate.sourceOccurrenceKey)).toEqual([
            CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
            "local-occurrence-other",
        ]);

        await application.execute(CALL_NOTES_DISMISS_COMMAND);
        const detectedAfterDismiss = await application.listDetectedCalls({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            limit: 50,
        });
        expect(detectedAfterDismiss.map(candidate => candidate.sourceOccurrenceKey)).toEqual([
            "local-occurrence-other",
        ]);
        expect(detectedQueries.at(-1)).toMatchObject({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
        });
        const teammateDetected = await application.listDetectedCalls({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.otherUserId,
            limit: 50,
        });
        expect(teammateDetected.map(candidate => candidate.sourceOccurrenceKey)).toEqual([
            CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
            "local-occurrence-other",
        ]);

        const firstStart = await startWithWorker(application);
        const replayedStart = await application.execute(CALL_NOTES_START_COMMAND);
        expect(firstStart?.id).toBeTruthy();
        expect(replayedStart?.id).toBe(firstStart?.id);
        const captureRows = await testDb.db.execute(sql`
            SELECT "capture_user_id"
            FROM "pdr_ai_v2_call_notes_captures"
            WHERE "call_id" = ${firstStart?.id}
        `);
        expect(captureRows).toEqual([
            expect.objectContaining({ capture_user_id: CALL_NOTES_FIXTURE_IDS.ownerUserId }),
        ]);

        const finalSnapshot = await runCallNotesVerticalTracer(application);
        expect(finalSnapshot.status).toBe("completed");
        expect(finalSnapshot.capture.outcome).toBe("partial");
        expect(finalSnapshot.capture.attemptCount).toBe(2);
        expect(finalSnapshot.transcript).toHaveLength(3);
        expect(finalSnapshot.transcript.map(segment => segment.text)).toEqual([
            "We need to reduce onboarding time before the September launch.",
            "I will send the revised onboarding checklist by Friday.",
            "That checklist and a short walkthrough should unblock our team.",
        ]);
        expect(finalSnapshot.gaps.length).toBeGreaterThanOrEqual(2);
        expect(callNoteIndex.syncs.at(-1)).toEqual({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            callId: finalSnapshot.id,
        });

        const segmentCount = await countTranscriptSegments(testDb);
        expect(segmentCount).toBe(3);
        const packetHashes = await testDb.db.execute(sql`
            SELECT "source_packet_hash"
            FROM "pdr_ai_v2_call_notes_transcript_segments"
            WHERE "call_id" = ${finalSnapshot.id}
            ORDER BY "source_packet_hash"
        `);
        expect(packetHashes.map(row => row.source_packet_hash)).toEqual([
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        ]);

        await expectApplicationCode(
            application
                .getCall({
                    companyId: CALL_NOTES_FIXTURE_IDS.companyId,
                    actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
                    callId: finalSnapshot.id,
                })
                .then(async snapshot => {
                    const note = snapshot.note;
                    if (!note) throw new Error("expected canonical note");
                    return application.execute(
                        parseUpdateNoteCommand({
                            ...CALL_NOTES_START_COMMAND,
                            requestId: "stale-note-update",
                            kind: "update_note",
                            callId: finalSnapshot.id,
                            baseRevision: note.revision - 1,
                            title: note.title,
                            contentMarkdown: note.contentMarkdown,
                            contentRich: note.contentRich,
                        })
                    );
                }),
            "conflict"
        );

        await expectApplicationCode(
            application.getCall({
                companyId: fixtures.betaCompanyId.toString(),
                actorUserId: "user_beta_owner",
                callId: finalSnapshot.id,
            }),
            "not_found"
        );

        await application.execute(
            CallNotesCommandSchema.parse({
                ...CALL_NOTES_START_COMMAND,
                requestId: "private-note-integration",
                kind: "set_note_visibility",
                callId: finalSnapshot.id,
                visibility: "private",
            })
        );
        const teammateSnapshot = await application.getCall({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.otherUserId,
            callId: finalSnapshot.id,
        });
        expect(teammateSnapshot.transcript).toHaveLength(3);
        expect(teammateSnapshot.note).toBeNull();
        expect(teammateSnapshot.enrichment).toBeNull();
        await expectApplicationCode(
            application.execute(
                CallNotesCommandSchema.parse({
                    ...CALL_NOTES_START_COMMAND,
                    actorUserId: CALL_NOTES_FIXTURE_IDS.otherUserId,
                })
            ),
            "forbidden"
        );
        const ownerSnapshot = await application.getCall({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            callId: finalSnapshot.id,
        });
        expect(ownerSnapshot.note?.contentMarkdown).toBe(finalSnapshot.note?.contentMarkdown);

        await expectApplicationCode(
            application.execute(
                CallNotesCommandSchema.parse({
                    ...CALL_NOTES_START_COMMAND,
                    requestId: "editor-delete-completed",
                    kind: "delete_call",
                    actorUserId: CALL_NOTES_FIXTURE_IDS.otherUserId,
                    callId: finalSnapshot.id,
                })
            ),
            "forbidden"
        );

        await application.execute(
            CallNotesCommandSchema.parse({
                ...CALL_NOTES_START_COMMAND,
                requestId: "admin-delete-completed",
                kind: "delete_call",
                actorUserId: "user_admin",
                callId: finalSnapshot.id,
            })
        );
        await expectApplicationCode(
            application.getCall({
                companyId: CALL_NOTES_FIXTURE_IDS.companyId,
                actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
                callId: finalSnapshot.id,
            }),
            "not_found"
        );
        expect(callNoteIndex.syncs.at(-1)).toEqual({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            callId: finalSnapshot.id,
        });
        expect(await countTranscriptSegments(testDb)).toBe(0);
    });

    it("redacts private enrichment and completes deletion even when document indexing fails", async () => {
        await insertFixtures(testDb);
        const indexedCallStates: unknown[] = [];
        const callNoteIndex = createCallNoteIndex(async input => {
            const rows = await testDb.db.execute(sql`
                SELECT "id" FROM "pdr_ai_v2_call_notes_calls"
                WHERE "company_id" = ${BigInt(input.companyId)} AND "id" = ${input.callId}
            `);
            indexedCallStates.push(rows[0]?.id ?? null);
        });
        const { application } = createApplication(testDb, { callNoteIndex });
        await heartbeatWorker(application);
        const finalSnapshot = await runCallNotesVerticalTracer(application);

        await application.execute(
            CallNotesCommandSchema.parse({
                ...CALL_NOTES_START_COMMAND,
                requestId: "private-enrichment-redaction",
                kind: "set_note_visibility",
                callId: finalSnapshot.id,
                visibility: "private",
            })
        );
        const teammate = await application.getCall({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.otherUserId,
            callId: finalSnapshot.id,
        });
        expect(teammate.note).toBeNull();
        expect(teammate.enrichment).toBeNull();
        const owner = await application.getCall({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            callId: finalSnapshot.id,
        });
        expect(owner.note?.visibility).toBe("private");
        expect(owner.enrichment?.proposal).toEqual(CALL_NOTES_ENRICHMENT_PROPOSAL);

        const syncCountBeforeDelete = callNoteIndex.syncs.length;
        callNoteIndex.failNextSync();
        const deleteCommand = CallNotesCommandSchema.parse({
            ...CALL_NOTES_START_COMMAND,
            requestId: "delete-with-index-failure",
            kind: "delete_call",
            actorUserId: "user_admin",
            callId: finalSnapshot.id,
        });
        await expect(application.execute(deleteCommand)).resolves.toBeNull();
        expect(callNoteIndex.syncs).toHaveLength(syncCountBeforeDelete + 1);
        expect(callNoteIndex.syncs.at(-1)).toEqual({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            callId: finalSnapshot.id,
        });
        expect(indexedCallStates.at(-1)).toBeNull();
        await expect(application.execute(deleteCommand)).resolves.toBeNull();
        expect(callNoteIndex.syncs).toHaveLength(syncCountBeforeDelete + 1);
        await expectApplicationCode(
            application.getCall({
                companyId: CALL_NOTES_FIXTURE_IDS.companyId,
                actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
                callId: finalSnapshot.id,
            }),
            "not_found"
        );

        const deleteReceipt = await testDb.db.execute(sql`
            SELECT "status", "call_id"
            FROM "pdr_ai_v2_call_notes_work_items"
            WHERE "company_id" = ${BigInt(CALL_NOTES_FIXTURE_IDS.companyId)}
              AND "kind" = 'finalize'
              AND "idempotency_key" = ${deleteCommand.requestId}
        `);
        expect(deleteReceipt[0]?.status).toBe("completed");
        expect(deleteReceipt[0]?.call_id).toBeNull();
    });

    it("persists private visibility and redacts the note even when document indexing fails", async () => {
        await insertFixtures(testDb);
        const { application, callNoteIndex } = createApplication(testDb);
        await heartbeatWorker(application);
        const finalSnapshot = await runCallNotesVerticalTracer(application);
        callNoteIndex.failNextSync();

        const command = CallNotesCommandSchema.parse({
            ...CALL_NOTES_START_COMMAND,
            requestId: "private-with-index-failure",
            kind: "set_note_visibility",
            callId: finalSnapshot.id,
            visibility: "private",
        });
        const changed = await application.execute(command);
        expect(changed?.note?.visibility).toBe("private");
        expect(callNoteIndex.syncs.at(-1)).toEqual({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            callId: finalSnapshot.id,
        });
        const teammate = await application.getCall({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.otherUserId,
            callId: finalSnapshot.id,
        });
        expect(teammate.note).toBeNull();
        expect(teammate.enrichment).toBeNull();
    });
    it("validates membership before converging an already-live occurrence", async () => {
        await insertFixtures(testDb);
        const { application } = createApplication(testDb);
        const started = await startWithWorker(application);
        if (!started) throw new Error("expected start snapshot");

        await expectApplicationCode(
            application.execute(
                CallNotesCommandSchema.parse({
                    ...CALL_NOTES_START_COMMAND,
                    requestId: "unknown-start-live-occurrence",
                    actorUserId: "user_unknown",
                })
            ),
            "forbidden"
        );
        const calls = await application.listCalls({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            limit: 10,
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.id).toBe(started.id);
    });

    it("deletes a just-created document Note when Call persistence fails", async () => {
        await insertFixtures(testDb);
        await testDb.db.execute(sql`
            CREATE FUNCTION "call_notes_test_fail_call_insert"()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $fn$
            BEGIN
                RAISE EXCEPTION 'fixture Call persistence failure';
                RETURN NEW;
            END;
            $fn$
        `);
        await testDb.db.execute(sql`
            CREATE TRIGGER "call_notes_test_fail_call_insert_trigger"
            BEFORE INSERT ON "pdr_ai_v2_call_notes_calls"
            FOR EACH ROW
            EXECUTE FUNCTION "call_notes_test_fail_call_insert"()
        `);
        const { application } = createApplication(testDb);

        const command = parseStartCaptureCommand({
            ...CALL_NOTES_START_COMMAND,
            requestId: "start-orphan-cleanup",
        });
        await expectApplicationCode(application.execute(command), "unavailable");
        await testDb.db.execute(sql`
            DROP TRIGGER IF EXISTS "call_notes_test_fail_call_insert_trigger"
            ON "pdr_ai_v2_call_notes_calls"
        `);
        await testDb.db.execute(sql`
            DROP FUNCTION IF EXISTS "call_notes_test_fail_call_insert"()
        `);

        const orphanedNotes = await testDb.db
            .select({ id: documentNotes.id })
            .from(documentNotes)
            .where(
                and(
                    eq(documentNotes.companyId, CALL_NOTES_FIXTURE_IDS.companyId),
                    eq(documentNotes.userId, CALL_NOTES_FIXTURE_IDS.ownerUserId),
                    eq(documentNotes.title, command.title ?? "Local audio call")
                )
            );
        expect(orphanedNotes).toHaveLength(0);
        const calls = await testDb.db.execute(sql`
            SELECT "id"
            FROM "pdr_ai_v2_call_notes_calls"
            WHERE "company_id" = ${BigInt(CALL_NOTES_FIXTURE_IDS.companyId)}
        `);
        expect(calls).toHaveLength(0);
    });

    it("keeps the winning same-base Note write canonical across all durable rows", async () => {
        await insertFixtures(testDb);
        let idSequence = 0;
        const ids: CallNotesIdSource = {
            next(prefix) {
                idSequence += 1;
                return `${prefix}-concurrent-${idSequence}`;
            },
        };
        const appA = createApplication(testDb, { ids }).application;
        await heartbeatWorker(appA);
        const sessionB = await testDb.createSession();
        try {
            const appB = createApplication(sessionB, { ids }).application;
            const started = await appA.execute(CALL_NOTES_START_COMMAND);
            if (!started?.note) throw new Error("expected started Note");
            const firstCommand = parseUpdateNoteCommand({
                ...CALL_NOTES_START_COMMAND,
                requestId: "same-base-note-a",
                kind: "update_note",
                callId: started.id,
                baseRevision: started.note.revision,
                title: started.note.title,
                contentMarkdown: "winner content A",
                contentRich: { type: "doc", content: [] },
            });
            const secondCommand = parseUpdateNoteCommand({
                ...CALL_NOTES_START_COMMAND,
                requestId: "same-base-note-b",
                kind: "update_note",
                callId: started.id,
                baseRevision: started.note.revision,
                title: started.note.title,
                contentMarkdown: "winner content B",
                contentRich: { type: "doc", content: [] },
            });
            await testDb.db.execute(sql`
                CREATE FUNCTION "call_notes_test_delay_note_update"()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $fn$
                BEGIN
                    PERFORM pg_sleep(0.05);
                    RETURN NEW;
                END;
                $fn$
            `);
            await testDb.db.execute(sql`
                CREATE TRIGGER "call_notes_test_delay_note_update_trigger"
                BEFORE UPDATE ON ${DOCUMENT_NOTES_TABLE}
                FOR EACH ROW
                EXECUTE FUNCTION "call_notes_test_delay_note_update"()
            `);

            const results = await Promise.allSettled([
                appA.execute(firstCommand),
                appB.execute(secondCommand),
            ]);
            const successful = results.flatMap((result, index) =>
                result.status === "fulfilled" ? [{ index, snapshot: result.value }] : []
            );
            expect(successful).toHaveLength(1);
            const winner = successful[0]!;
            const winnerContent =
                winner.index === 0 ? firstCommand.contentMarkdown : secondCommand.contentMarkdown;
            const loser = results[winner.index === 0 ? 1 : 0];
            expect(loser.status).toBe("rejected");
            if (loser.status === "rejected") {
                expect(loser.reason).toMatchObject({ code: "conflict" });
            }

            const current = await appA.getCall({
                companyId: CALL_NOTES_FIXTURE_IDS.companyId,
                actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
                callId: started.id,
            });
            expect(current.note?.revision).toBe(1);
            expect(current.note?.contentMarkdown).toBe(winnerContent);
            if (!current.note?.documentNoteId) throw new Error("expected document Note id");

            const canonical = await testDb.db
                .select({ contentMarkdown: documentNotes.contentMarkdown })
                .from(documentNotes)
                .where(eq(documentNotes.id, current.note.documentNoteId))
                .limit(1);
            expect(canonical[0]?.contentMarkdown).toBe(winnerContent);
            const callRows = await testDb.db.execute(sql`
                SELECT "current_note_revision", "document_note_id"
                FROM "pdr_ai_v2_call_notes_calls"
                WHERE "id" = ${started.id}
            `);
            expect(callRows[0]?.current_note_revision).toBe(1);
            expect(Number(callRows[0]?.document_note_id)).toBe(current.note.documentNoteId);
            const revisions = await testDb.db.execute(sql`
                SELECT "revision", "content_markdown"
                FROM "pdr_ai_v2_call_notes_note_revisions"
                WHERE "call_id" = ${started.id}
                ORDER BY "revision"
            `);
            expect(revisions).toEqual([
                expect.objectContaining({ revision: 0, content_markdown: "" }),
                expect.objectContaining({ revision: 1, content_markdown: winnerContent }),
            ]);
        } finally {
            await testDb.db.execute(sql`
                DROP TRIGGER IF EXISTS "call_notes_test_delay_note_update_trigger"
                ON ${DOCUMENT_NOTES_TABLE}
            `);
            await testDb.db.execute(sql`
                DROP FUNCTION IF EXISTS "call_notes_test_delay_note_update"()
            `);
            await sessionB.close();
        }
    });

    it("commits a Note's content and title before indexing and succeeds when indexing fails", async () => {
        await insertFixtures(testDb);
        const indexedNotes: unknown[] = [];
        const callNoteIndex = createCallNoteIndex(async input => {
            const rows = await testDb.db.execute(sql`
                SELECT c."current_note_revision", n."title", n."content_markdown"
                FROM "pdr_ai_v2_call_notes_calls" c
                JOIN ${DOCUMENT_NOTES_TABLE} n ON n."id" = c."document_note_id"
                WHERE c."company_id" = ${BigInt(input.companyId)} AND c."id" = ${input.callId}
            `);
            indexedNotes.push(rows[0]);
        });
        const { application } = createApplication(testDb, { callNoteIndex });
        const started = await startWithWorker(application);
        if (!started?.note) throw new Error("expected started Note");
        callNoteIndex.failNextSync();

        const edit = parseUpdateNoteCommand({
            ...CALL_NOTES_START_COMMAND,
            requestId: "edit-with-index-failure",
            kind: "update_note",
            callId: started.id,
            baseRevision: started.note.revision,
            title: "Owner-renamed canonical note",
            contentMarkdown: "Owner-authored indexed content",
            contentRich: { type: "doc", content: [] },
        });
        const edited = await application.execute(edit);
        expect(edited?.note).toMatchObject({
            revision: 1,
            title: edit.title,
            contentMarkdown: edit.contentMarkdown,
        });
        expect(callNoteIndex.syncs).toEqual([
            { companyId: CALL_NOTES_FIXTURE_IDS.companyId, callId: started.id },
        ]);
        expect(indexedNotes).toEqual([
            expect.objectContaining({
                current_note_revision: 1,
                title: edit.title,
                content_markdown: edit.contentMarkdown,
            }),
        ]);
        const replay = await application.execute(edit);
        expect(replay?.note?.revision).toBe(1);
        expect(replay?.note?.contentMarkdown).toBe(edit.contentMarkdown);
        expect(callNoteIndex.syncs).toHaveLength(1);
    });

    it.each([{ legacyReindex: true }, { legacyReindex: false }])(
        "replays a failed Note edit only with legacy reindex evidence ($legacyReindex)",
        async ({ legacyReindex }) => {
            await insertFixtures(testDb);
            const requestId = "legacy-failed-note-edit";
            const receiptStatusesAtSync: unknown[] = [];
            const callNoteIndex = createCallNoteIndex(async input => {
                const rows = await testDb.db.execute(sql`
                    SELECT "status"
                    FROM "pdr_ai_v2_call_notes_work_items"
                    WHERE "company_id" = ${BigInt(input.companyId)}
                      AND "kind" = 'finalize'
                      AND "idempotency_key" = ${requestId}
                `);
                receiptStatusesAtSync.push(rows[0]?.status);
            });
            const { application } = createApplication(testDb, { callNoteIndex });
            const started = await startWithWorker(application);
            if (!started?.note) throw new Error("expected started Note");
            const edit = parseUpdateNoteCommand({
                ...CALL_NOTES_START_COMMAND,
                requestId,
                kind: "update_note",
                callId: started.id,
                baseRevision: started.note.revision,
                title: "Committed legacy Call Note",
                contentMarkdown: "This edit committed before legacy reindexing failed.",
                contentRich: { type: "doc", content: [] },
            });
            await application.execute(edit);
            const committedRevisions = await testDb.db.execute(sql`
                SELECT "id", "revision", "title", "content_markdown", "content_rich", "created_at"
                FROM "pdr_ai_v2_call_notes_note_revisions"
                WHERE "call_id" = ${started.id}
                ORDER BY "revision"
            `);

            // Recreate the pre-cutover failure: the Note committed, but indexing
            // left its command receipt failed with the original command payload.
            await testDb.db.execute(sql`
                UPDATE "pdr_ai_v2_call_notes_work_items"
                SET "status" = 'failed',
                    "payload" = ${JSON.stringify({ command: edit })}::jsonb,
                    "completed_at" = NULL,
                    "error_code" = 'unavailable',
                    "error_message" = 'Legacy knowledge reindex failed'
                WHERE "company_id" = ${BigInt(edit.companyId)}
                  AND "kind" = 'finalize'
                  AND "idempotency_key" = ${edit.requestId}
            `);
            if (legacyReindex) {
                await testDb.db.execute(sql`
                    INSERT INTO "pdr_ai_v2_call_notes_work_items"
                        ("id", "company_id", "call_id", "kind", "idempotency_key",
                         "payload", "status")
                    VALUES (
                        'legacy-note-reindex',
                        ${BigInt(edit.companyId)},
                        ${edit.callId},
                        'reindex',
                        ${`reindex:${edit.callId}:${edit.baseRevision + 1}`},
                        ${JSON.stringify({
                            callId: edit.callId,
                            revision: edit.baseRevision + 1,
                        })}::jsonb,
                        'failed'
                    )
                `);
            }
            callNoteIndex.syncs.length = 0;
            receiptStatusesAtSync.length = 0;

            if (legacyReindex) {
                await expect(application.execute(edit)).resolves.toMatchObject({
                    note: {
                        revision: edit.baseRevision + 1,
                        title: edit.title,
                        contentMarkdown: edit.contentMarkdown,
                        contentRich: edit.contentRich,
                    },
                });
            } else {
                await expectApplicationCode(application.execute(edit), "conflict");
            }
            expect(callNoteIndex.syncs).toEqual(
                legacyReindex ? [{ companyId: edit.companyId, callId: edit.callId }] : []
            );
            expect(receiptStatusesAtSync).toEqual(legacyReindex ? ["completed"] : []);
            const receiptRows = await testDb.db.execute(sql`
                SELECT "status", "payload"
                FROM "pdr_ai_v2_call_notes_work_items"
                WHERE "company_id" = ${BigInt(edit.companyId)}
                  AND "kind" = 'finalize'
                  AND "idempotency_key" = ${edit.requestId}
            `);
            expect(receiptRows[0]?.status).toBe(legacyReindex ? "completed" : "failed");
            if (legacyReindex) {
                expect(receiptRows[0]?.payload).toMatchObject({
                    resultCallId: edit.callId,
                    resultActorUserId: edit.actorUserId,
                });
                await expect(application.execute(edit)).resolves.toMatchObject({
                    note: { revision: edit.baseRevision + 1 },
                });
                expect(callNoteIndex.syncs).toHaveLength(1);
            }

            const otherEdit = parseUpdateNoteCommand({
                ...edit,
                requestId: "different-stale-note-edit",
                contentMarkdown: "A different command must not overwrite the committed edit.",
            });
            await expectApplicationCode(application.execute(otherEdit), "conflict");
            await expectApplicationCode(application.execute(otherEdit), "conflict");
            const revisionsAfterReplay = await testDb.db.execute(sql`
                SELECT "id", "revision", "title", "content_markdown", "content_rich", "created_at"
                FROM "pdr_ai_v2_call_notes_note_revisions"
                WHERE "call_id" = ${started.id}
                ORDER BY "revision"
            `);
            expect(revisionsAfterReplay).toEqual(committedRevisions);
            const current = await application.getCall({
                companyId: edit.companyId,
                actorUserId: edit.actorUserId,
                callId: edit.callId,
            });
            expect(current.note).toMatchObject({
                revision: edit.baseRevision + 1,
                title: edit.title,
                contentMarkdown: edit.contentMarkdown,
                contentRich: edit.contentRich,
            });
        }
    );

    it("indexes only accepted enrichment and preserves acceptance when indexing fails", async () => {
        await insertFixtures(testDb);
        const { application, callNoteIndex } = createApplication(testDb);
        const started = await startWithWorker(application);
        if (!started?.note) throw new Error("expected started Note");

        const firstEdit = parseUpdateNoteCommand({
            ...CALL_NOTES_START_COMMAND,
            requestId: "acceptance-base",
            kind: "update_note",
            callId: started.id,
            baseRevision: started.note.revision,
            title: started.note.title,
            contentMarkdown: "base indexed content",
            contentRich: { type: "doc", content: [] },
        });
        await application.execute(firstEdit);

        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CALL_NOTES_CAPTURE_EVENTS[0]!
        );
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CALL_NOTES_CAPTURE_EVENTS[3]!
        );
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CALL_NOTES_CAPTURE_EVENTS[12]!
        );
        const syncCountBeforeProposal = callNoteIndex.syncs.length;
        const requested = await application.execute(
            CallNotesCommandSchema.parse({
                ...CALL_NOTES_START_COMMAND,
                requestId: "request-acceptance-retry",
                kind: "request_enrichment",
                callId: started.id,
            })
        );
        if (!requested?.enrichment) throw new Error("expected enrichment run");
        await application.completeEnrichment(
            CompleteEnrichmentInputSchema.parse({
                companyId: CALL_NOTES_FIXTURE_IDS.companyId,
                callId: started.id,
                enrichmentRunId: requested.enrichment.id,
                result: {
                    proposal: CALL_NOTES_ENRICHMENT_PROPOSAL,
                    modelMetadata: {
                        provider: "fixture",
                        model: "deterministic-enrichment",
                        promptVersion: "call-notes/v1",
                        completionId: "acceptance-retry",
                    },
                },
            })
        );
        const ready = await application.getCall({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            callId: started.id,
        });
        if (!ready.enrichment) throw new Error("expected ready enrichment run");

        expect(callNoteIndex.syncs).toHaveLength(syncCountBeforeProposal);
        callNoteIndex.failNextSync();
        const acceptance = parseAcceptEnrichmentCommand({
            ...CALL_NOTES_START_COMMAND,
            requestId: "acceptance-with-transient-index-failure",
            kind: "accept_enrichment",
            callId: started.id,
            enrichmentRunId: ready.enrichment.id,
            contentMarkdown: RENDERED_ENRICHMENT_PROPOSAL.contentMarkdown,
            contentRich: RENDERED_ENRICHMENT_PROPOSAL.contentRich,
        });
        const accepted = await application.execute(acceptance);
        expect(accepted?.enrichment?.status).toBe("accepted");
        const committed = await application.getCall({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            callId: started.id,
        });
        expect(committed.note?.revision).toBe(2);
        expect(committed.note?.contentMarkdown).toBe(RENDERED_ENRICHMENT_PROPOSAL.contentMarkdown);
        expect(committed.enrichment?.status).toBe("accepted");
        expect(callNoteIndex.syncs.at(-1)).toEqual({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            callId: started.id,
        });
        expect(callNoteIndex.syncs).toHaveLength(syncCountBeforeProposal + 1);

        const replay = await application.execute(acceptance);
        expect(replay?.note?.revision).toBe(2);
        expect(replay?.enrichment?.status).toBe("accepted");
        expect(callNoteIndex.syncs).toHaveLength(syncCountBeforeProposal + 1);
    });

    it("resolves concurrent enrichment acceptance and rejection with one winner", async () => {
        await insertFixtures(testDb);
        let idSequence = 0;
        const ids: CallNotesIdSource = {
            next(prefix) {
                idSequence += 1;
                return `${prefix}-resolve-${idSequence}`;
            },
        };
        const appA = createApplication(testDb, { ids }).application;
        await heartbeatWorker(appA);
        const started = await appA.execute(CALL_NOTES_START_COMMAND);
        if (!started) throw new Error("expected start snapshot");
        await appA.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CALL_NOTES_CAPTURE_EVENTS[0]!
        );
        await appA.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CALL_NOTES_CAPTURE_EVENTS[3]!
        );
        await appA.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CALL_NOTES_CAPTURE_EVENTS[12]!
        );
        const requested = await appA.execute(
            CallNotesCommandSchema.parse({
                ...CALL_NOTES_START_COMMAND,
                requestId: "concurrent-enrichment-request",
                kind: "request_enrichment",
                callId: started.id,
            })
        );
        if (!requested?.enrichment) throw new Error("expected enrichment run");
        await appA.completeEnrichment(
            CompleteEnrichmentInputSchema.parse({
                companyId: CALL_NOTES_FIXTURE_IDS.companyId,
                callId: started.id,
                enrichmentRunId: requested.enrichment.id,
                result: {
                    proposal: CALL_NOTES_ENRICHMENT_PROPOSAL,
                    modelMetadata: {
                        provider: "fixture",
                        model: "deterministic-enrichment",
                        promptVersion: "call-notes/v1",
                        completionId: "concurrent-resolve",
                    },
                },
            })
        );

        const sessionB = await testDb.createSession();
        try {
            const appB = createApplication(sessionB, { ids }).application;
            const accept = parseAcceptEnrichmentCommand({
                ...CALL_NOTES_START_COMMAND,
                requestId: "concurrent-enrichment-accept",
                kind: "accept_enrichment",
                callId: started.id,
                enrichmentRunId: requested.enrichment.id,
                contentMarkdown: RENDERED_ENRICHMENT_PROPOSAL.contentMarkdown,
                contentRich: RENDERED_ENRICHMENT_PROPOSAL.contentRich,
            });
            const reject = CallNotesCommandSchema.parse({
                ...CALL_NOTES_START_COMMAND,
                requestId: "concurrent-enrichment-reject",
                kind: "reject_enrichment",
                callId: started.id,
                enrichmentRunId: requested.enrichment.id,
            });
            const results = await Promise.allSettled([appA.execute(accept), appB.execute(reject)]);
            const successful = results.flatMap((result, index) =>
                result.status === "fulfilled" ? [{ index }] : []
            );
            expect(successful).toHaveLength(1);
            const winnerIndex = successful[0]!.index;
            const loser = results[winnerIndex === 0 ? 1 : 0];
            expect(loser.status).toBe("rejected");
            if (loser.status === "rejected") {
                expect(loser.reason).toMatchObject({ code: "conflict" });
            }

            const runRows = await testDb.db.execute(sql`
                SELECT "status"
                FROM "pdr_ai_v2_call_notes_enrichment_runs"
                WHERE "id" = ${requested.enrichment.id}
            `);
            const callRows = await testDb.db.execute(sql`
                SELECT "current_note_revision", "document_note_id"
                FROM "pdr_ai_v2_call_notes_calls"
                WHERE "id" = ${started.id}
            `);
            const revisions = await testDb.db.execute(sql`
                SELECT "revision", "content_markdown"
                FROM "pdr_ai_v2_call_notes_note_revisions"
                WHERE "call_id" = ${started.id}
                ORDER BY "revision"
            `);
            const documentNoteId = callRows[0]?.document_note_id;
            const canonical =
                documentNoteId === undefined || documentNoteId === null
                    ? []
                    : await testDb.db
                          .select({ contentMarkdown: documentNotes.contentMarkdown })
                          .from(documentNotes)
                          .where(eq(documentNotes.id, Number(documentNoteId)))
                          .limit(1);
            if (winnerIndex === 0) {
                expect(runRows[0]?.status).toBe("accepted");
                expect(callRows[0]?.current_note_revision).toBe(1);
                expect(canonical[0]?.contentMarkdown).toBe(
                    RENDERED_ENRICHMENT_PROPOSAL.contentMarkdown
                );
                expect(revisions).toEqual([
                    expect.objectContaining({ revision: 0, content_markdown: "" }),
                    expect.objectContaining({
                        revision: 1,
                        content_markdown: RENDERED_ENRICHMENT_PROPOSAL.contentMarkdown,
                    }),
                ]);
            } else {
                expect(runRows[0]?.status).toBe("rejected");
                expect(callRows[0]?.current_note_revision).toBe(0);
                expect(canonical[0]?.contentMarkdown).toBe("");
                expect(revisions).toEqual([
                    expect.objectContaining({ revision: 0, content_markdown: "" }),
                ]);
            }
        } finally {
            await sessionB.close();
        }
    });

    it("claims concurrent duplicate capture events before applying participants and gaps", async () => {
        await insertFixtures(testDb);
        let idSequence = 0;
        const ids: CallNotesIdSource = {
            next(prefix) {
                idSequence += 1;
                return `${prefix}-duplicate-${idSequence}`;
            },
        };
        const appA = createApplication(testDb, { ids }).application;
        await heartbeatWorker(appA);
        const sessionB = await testDb.createSession();
        try {
            const appB = createApplication(sessionB, { ids }).application;
            const started = await appA.execute(CALL_NOTES_START_COMMAND);
            if (!started) throw new Error("expected start snapshot");
            await appA.ingestCaptureEvent(
                CALL_NOTES_FIXTURE_IDS.companyId,
                CALL_NOTES_CAPTURE_EVENTS[0]!
            );

            const participantEvent = CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[1]!,
                eventId: "duplicate-participant-event",
            });
            await Promise.all([
                appA.ingestCaptureEvent(CALL_NOTES_FIXTURE_IDS.companyId, participantEvent),
                appB.ingestCaptureEvent(CALL_NOTES_FIXTURE_IDS.companyId, participantEvent),
            ]);
            const participants = await testDb.db.execute(sql`
                SELECT "id"
                FROM "pdr_ai_v2_call_notes_participants"
                WHERE "call_id" = ${started.id}
            `);
            expect(participants).toHaveLength(1);

            const pauseEvent = CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[4]!,
                eventId: "duplicate-pause-event",
            });
            await Promise.all([
                appA.ingestCaptureEvent(CALL_NOTES_FIXTURE_IDS.companyId, pauseEvent),
                appB.ingestCaptureEvent(CALL_NOTES_FIXTURE_IDS.companyId, pauseEvent),
            ]);
            const gaps = await testDb.db.execute(sql`
                SELECT "id"
                FROM "pdr_ai_v2_call_notes_gaps"
                WHERE "call_id" = ${started.id}
                  AND "kind" = 'user_paused'
            `);
            expect(gaps).toHaveLength(1);
        } finally {
            await sessionB.close();
        }
    });

    it("recomputes a terminal capture outcome when the first transcript arrives late", async () => {
        await insertFixtures(testDb);
        const { application } = createApplication(testDb);
        const started = await startWithWorker(application);
        if (!started) throw new Error("expected start snapshot");
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CALL_NOTES_CAPTURE_EVENTS[0]!
        );
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[0]!,
                eventId: "attempt-failed-before-transcript",
                kind: "attempt_failed",
                code: "capture_stream_lost",
                occurredAt: "2026-08-15T14:02:00.000Z",
            })
        );
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[12]!,
                eventId: "occurrence-ended-before-transcript",
            })
        );
        const failed = await application.getCall({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            callId: started.id,
        });
        expect(failed.status).toBe("failed");
        expect(failed.capture.outcome).toBe("failed");
        expect(failed.transcript).toHaveLength(0);

        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[3]!,
                eventId: "late-first-transcript",
                sourcePacketHash:
                    "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            })
        );
        const recomputed = await application.getCall({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            callId: started.id,
        });
        expect(recomputed.status).toBe("completed");
        expect(recomputed.capture.outcome).toBe("partial");
        expect(recomputed.transcript).toHaveLength(1);
    });

    it("closes a gap only for the attempt named by the reconnect event", async () => {
        await insertFixtures(testDb);
        const { application } = createApplication(testDb);
        const started = await startWithWorker(application);
        if (!started) throw new Error("expected start snapshot");
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CALL_NOTES_CAPTURE_EVENTS[0]!
        );
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[0]!,
                eventId: "transport-interrupted-attempt-one",
                kind: "transport_interrupted",
                reason: "network",
                occurredAt: "2026-08-15T14:03:00.000Z",
            })
        );
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[0]!,
                eventId: "attempt-connected-two",
                sourceAttemptKey: CALL_NOTES_FIXTURE_IDS.secondSourceAttemptKey,
                sourceStreamKey: "local-stream-2",
                occurredAt: "2026-08-15T14:04:00.000Z",
            })
        );
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[0]!,
                eventId: "transport-interrupted-attempt-two",
                sourceAttemptKey: CALL_NOTES_FIXTURE_IDS.secondSourceAttemptKey,
                kind: "transport_interrupted",
                reason: "network",
                occurredAt: "2026-08-15T14:05:00.000Z",
            })
        );
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[0]!,
                eventId: "transport-reconnected-attempt-two",
                sourceAttemptKey: CALL_NOTES_FIXTURE_IDS.secondSourceAttemptKey,
                kind: "transport_reconnected",
                occurredAt: "2026-08-15T14:06:00.000Z",
            })
        );

        const gaps = await testDb.db.execute(sql`
            SELECT "attempt_id", "ended_at"
            FROM "pdr_ai_v2_call_notes_gaps"
            WHERE "call_id" = ${started.id}
              AND "kind" = 'transport_interruption'
            ORDER BY "started_at"
        `);
        expect(gaps).toHaveLength(2);
        expect(gaps[0]?.attempt_id).not.toBe(gaps[1]?.attempt_id);
        expect(gaps[0]?.ended_at).toBeNull();
        expect(gaps[1]?.ended_at).toBeTruthy();
    });

    it("keeps participant sessions distinct while local audio transcripts remain unattributed", async () => {
        await insertFixtures(testDb);
        const { application } = createApplication(testDb);
        const started = await startWithWorker(application);
        if (!started) throw new Error("expected start snapshot");
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CALL_NOTES_CAPTURE_EVENTS[0]!
        );
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[1]!,
                eventId: "participant-session-one-joined",
                participant: {
                    sourceParticipantKey: "reused-participant-key",
                    sourceSessionKey: "source-session-one",
                    displayName: "Reused Participant",
                },
            })
        );
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[1]!,
                eventId: "participant-session-two-joined",
                participant: {
                    sourceParticipantKey: "reused-participant-key",
                    sourceSessionKey: "source-session-two",
                    displayName: "Reused Participant",
                },
                occurredAt: "2026-08-15T14:00:03.000Z",
            })
        );
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[1]!,
                eventId: "participant-session-one-left",
                kind: "participant_left",
                participant: {
                    sourceParticipantKey: "reused-participant-key",
                    sourceSessionKey: "source-session-one",
                    displayName: "Reused Participant",
                },
                occurredAt: "2026-08-15T14:00:05.000Z",
            })
        );
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[3]!,
                eventId: "transcript-session-one",
                participant: null,
                audioChannel: "system",
                sourcePacketHash:
                    "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            })
        );

        const participants = await testDb.db.execute(sql`
            SELECT "id", "source_session_key", "left_at"
            FROM "pdr_ai_v2_call_notes_participants"
            WHERE "call_id" = ${started.id}
              AND "source_participant_key" = 'reused-participant-key'
            ORDER BY "observed_at"
        `);
        expect(participants).toHaveLength(2);
        expect(participants[0]?.source_session_key).toBe("source-session-one");
        expect(participants[0]?.left_at).toBeTruthy();
        expect(participants[1]?.source_session_key).toBe("source-session-two");
        expect(participants[1]?.left_at).toBeNull();
        const transcript = await testDb.db.execute(sql`
            SELECT "participant_id", "audio_channel"
            FROM "pdr_ai_v2_call_notes_transcript_segments"
            WHERE "call_id" = ${started.id}
        `);
        expect(transcript[0]?.participant_id).toBeNull();
        expect(transcript[0]?.audio_channel).toBe("system");
    });

    it("does not let a capture replay replace immutable evidence or cross company boundaries", async () => {
        const fixtures = await insertFixtures(testDb);
        const { application, callNoteIndex } = createApplication(testDb);
        const started = await startWithWorker(application);
        if (!started) throw new Error("expected start snapshot");

        const firstSegment = CALL_NOTES_CAPTURE_EVENTS.find(
            (event): event is Extract<CaptureEvent, { kind: "transcript_segment" }> =>
                event.kind === "transcript_segment"
        );
        if (!firstSegment) throw new Error("fixture transcript segment missing");
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CALL_NOTES_CAPTURE_EVENTS[0]!
        );
        await application.ingestCaptureEvent(CALL_NOTES_FIXTURE_IDS.companyId, firstSegment);
        await application.ingestCaptureEvent(CALL_NOTES_FIXTURE_IDS.companyId, firstSegment);
        const replay = await application.getCall({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            callId: started.id,
        });
        expect(replay.transcript).toHaveLength(1);
        expect(replay.transcript[0]?.text).toBe(firstSegment.text);

        const otherCompanyEvent = CaptureEventSchema.parse({
            ...firstSegment,
            eventId: "event-cross-company",
            sourceOccurrenceKey: "local-occurrence-cross-company",
        });
        await expectApplicationCode(
            application.ingestCaptureEvent(fixtures.betaCompanyId.toString(), otherCompanyEvent),
            "not_found"
        );
        expect(callNoteIndex.syncs).toEqual([]);
    });

    it("requires a fresh worker heartbeat before creating a Call", async () => {
        await insertFixtures(testDb);
        const { application } = createApplication(testDb);
        await expectApplicationCode(application.execute(CALL_NOTES_START_COMMAND), "unavailable");
        const calls = await testDb.db.execute(sql`
            SELECT COUNT(*)::int AS count
            FROM "pdr_ai_v2_call_notes_calls"
        `);
        expect(Number(calls[0]?.count)).toBe(0);
    });

    it("records worker heartbeats by company and user and gates a fresh Start", async () => {
        await insertFixtures(testDb);
        const { application } = createApplication(testDb);
        await expect(
            application.pollLocalCapture({
                companyId: CALL_NOTES_FIXTURE_IDS.companyId,
                userId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
                workerId: "ready-worker",
            })
        ).resolves.toEqual({ capture: null });
        await expect(
            application.getLocalCaptureWorkerStatus({
                companyId: CALL_NOTES_FIXTURE_IDS.companyId,
                userId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            })
        ).resolves.toEqual({
            available: true,
            lastSeenAt: FIXED_NOW.toISOString(),
        });
        const started = await application.execute(CALL_NOTES_START_COMMAND);
        expect(started).toMatchObject({
            status: "active",
            capture: { lifecycle: "connecting", activeAttemptId: null },
        });
    });

    it("reconciles a stale worker lease to a partial terminal outcome and rejects stale events", async () => {
        await insertFixtures(testDb);
        let now = new Date(FIXED_NOW);
        const { application, callNoteIndex } = createApplication(testDb, {
            clock: { now: () => new Date(now) },
        });
        const workerId = "stale-worker";
        await heartbeatWorker(application, workerId);
        const started = await application.execute(CALL_NOTES_START_COMMAND);
        if (!started) throw new Error("expected start snapshot");
        await expect(
            application.pollLocalCapture({
                companyId: CALL_NOTES_FIXTURE_IDS.companyId,
                userId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
                workerId,
            })
        ).resolves.toMatchObject({ capture: { attemptKey: workerId } });
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[3]!,
                eventId: "stale-worker-transcript",
                sourceAttemptKey: workerId,
            })
        );

        now = new Date(FIXED_NOW.getTime() + 16_000);
        await expect(
            application.getLocalCaptureWorkerStatus({
                companyId: CALL_NOTES_FIXTURE_IDS.companyId,
                userId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            })
        ).resolves.toEqual({
            available: false,
            lastSeenAt: FIXED_NOW.toISOString(),
        });
        const recovered = await application.getCall({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            callId: started.id,
        });
        expect(recovered).toMatchObject({
            status: "completed",
            capture: {
                lifecycle: "completed",
                outcome: "partial",
                activeAttemptId: null,
            },
        });
        expect(callNoteIndex.syncs).toEqual([
            { companyId: CALL_NOTES_FIXTURE_IDS.companyId, callId: started.id },
        ]);
        expect(recovered.gaps).toEqual([
            expect.objectContaining({ kind: "worker_unavailable", endedAt: now.toISOString() }),
        ]);
        await expectApplicationCode(
            application.ingestLocalCaptureEvent(
                CALL_NOTES_FIXTURE_IDS.companyId,
                CaptureEventSchema.parse({
                    ...CALL_NOTES_CAPTURE_EVENTS[0]!,
                    eventId: "stale-worker-event",
                    sourceAttemptKey: workerId,
                })
            ),
            "forbidden"
        );
    });

    it("reconciles a stopped capture after its owned lease expires", async () => {
        await insertFixtures(testDb);
        let now = new Date(FIXED_NOW);
        const { application } = createApplication(testDb, {
            clock: { now: () => new Date(now) },
        });
        const workerId = "stopped-worker";
        await heartbeatWorker(application, workerId);
        const started = await application.execute(CALL_NOTES_START_COMMAND);
        if (!started) throw new Error("expected start snapshot");
        await application.pollLocalCapture({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            userId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            workerId,
        });
        const stop = CallNotesCommandSchema.parse({
            ...CALL_NOTES_START_COMMAND,
            kind: "stop_capture",
            requestId: "stale-stop",
            callId: started.id,
        });
        await expect(application.execute(stop)).resolves.toMatchObject({
            status: "finalizing",
            capture: { desiredMode: "stopped", lifecycle: "finalizing" },
        });
        now = new Date(FIXED_NOW.getTime() + 16_000);
        await expect(
            application.getCall({
                companyId: CALL_NOTES_FIXTURE_IDS.companyId,
                actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
                callId: started.id,
            })
        ).resolves.toMatchObject({
            status: "failed",
            capture: { lifecycle: "failed", outcome: "failed", activeAttemptId: null },
        });
    });

    it("isolates worker availability across users", async () => {
        await insertFixtures(testDb);
        const { application } = createApplication(testDb);
        await heartbeatWorker(application, "owner-only-worker");
        await expect(
            application.getLocalCaptureWorkerStatus({
                companyId: CALL_NOTES_FIXTURE_IDS.companyId,
                userId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            })
        ).resolves.toMatchObject({ available: true });
        await expect(
            application.getLocalCaptureWorkerStatus({
                companyId: CALL_NOTES_FIXTURE_IDS.companyId,
                userId: CALL_NOTES_FIXTURE_IDS.otherUserId,
            })
        ).resolves.toEqual({ available: false, lastSeenAt: null });
        const teammateStart = CallNotesCommandSchema.parse({
            ...CALL_NOTES_START_COMMAND,
            actorUserId: CALL_NOTES_FIXTURE_IDS.otherUserId,
            requestId: "teammate-without-worker",
            sourceOccurrenceKey: "teammate-occurrence-without-worker",
        });
        await expectApplicationCode(application.execute(teammateStart), "unavailable");
        const calls = await testDb.db.execute(sql`
            SELECT "source_occurrence_key"
            FROM "pdr_ai_v2_call_notes_calls"
        `);
        expect(calls).toHaveLength(0);
    });

    it("stops an unclaimed Capture without handing audio work to a worker", async () => {
        await insertFixtures(testDb);
        const { application } = createApplication(testDb);
        const started = await startWithWorker(application);
        if (!started) throw new Error("expected start snapshot");
        const stop = CallNotesCommandSchema.parse({
            ...CALL_NOTES_START_COMMAND,
            kind: "stop_capture",
            requestId: "stop-before-worker-claim",
            callId: started.id,
        });
        const stopped = await application.execute(stop);
        expect(stopped).toMatchObject({
            status: "failed",
            capture: { desiredMode: "stopped", lifecycle: "failed", attemptCount: 0 },
        });
        await expect(
            application.pollLocalCapture({
                companyId: CALL_NOTES_FIXTURE_IDS.companyId,
                userId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
                workerId: "worker-arriving-after-stop",
            })
        ).resolves.toEqual({ capture: null });
        await expect(
            application.execute({ ...stop, requestId: "repeated-pending-stop" })
        ).resolves.toMatchObject({ status: "failed" });
        await expectApplicationCode(
            application.execute(
                CallNotesCommandSchema.parse({
                    ...stop,
                    kind: "resume_capture",
                    requestId: "resume-stopped-capture",
                })
            ),
            "invalid_transition"
        );
    });

    it("claims one explicit capture per worker, drains a user stop, and rejects foreign control", async () => {
        await insertFixtures(testDb);
        const { application } = createApplication(testDb);
        const started = await startWithWorker(application);
        if (!started) throw new Error("expected start snapshot");

        await expectApplicationCode(
            application.execute(
                CallNotesCommandSchema.parse({
                    ...CALL_NOTES_START_COMMAND,
                    requestId: "second-active-occurrence",
                    sourceOccurrenceKey: "local-occurrence-second",
                })
            ),
            "conflict"
        );
        await expectApplicationCode(
            application.execute(
                CallNotesCommandSchema.parse({
                    ...CALL_NOTES_START_COMMAND,
                    requestId: "unauthorized-stop",
                    kind: "stop_capture",
                    actorUserId: CALL_NOTES_FIXTURE_IDS.otherUserId,
                    callId: started.id,
                })
            ),
            "forbidden"
        );

        const workerId = "local-worker-1";
        const firstPoll = await application.pollLocalCapture({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            userId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            workerId,
        });
        expect(firstPoll.capture).toMatchObject({
            callId: started.id,
            occurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
            attemptKey: workerId,
            desiredMode: "running",
        });
        const replayedPoll = await application.pollLocalCapture({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            userId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            workerId,
        });
        expect(replayedPoll).toEqual(firstPoll);
        const foreignPoll = await application.pollLocalCapture({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            userId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            workerId: "local-worker-2",
        });
        expect(foreignPoll.capture).toBeNull();

        const connected = CaptureEventSchema.parse({
            ...CALL_NOTES_CAPTURE_EVENTS[0]!,
            eventId: "explicit-connected",
            sourceAttemptKey: workerId,
        });
        await application.ingestLocalCaptureEvent(CALL_NOTES_FIXTURE_IDS.companyId, connected);
        const stopped = await application.execute(
            CallNotesCommandSchema.parse({
                ...CALL_NOTES_START_COMMAND,
                requestId: "owner-stop",
                kind: "stop_capture",
                callId: started.id,
            })
        );
        expect(stopped?.status).toBe("finalizing");
        expect(stopped?.capture.desiredMode).toBe("stopped");

        const stoppedPoll = await application.pollLocalCapture({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            userId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            workerId,
        });
        expect(stoppedPoll.capture).toMatchObject({
            callId: started.id,
            attemptKey: workerId,
            desiredMode: "stopped",
        });

        const transcript = CaptureEventSchema.parse({
            ...CALL_NOTES_CAPTURE_EVENTS[3]!,
            eventId: "explicit-transcript-after-stop",
            sourceAttemptKey: workerId,
        });
        await application.ingestLocalCaptureEvent(CALL_NOTES_FIXTURE_IDS.companyId, transcript);
        await application.ingestLocalCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[8]!,
                eventId: "explicit-attempt-ended",
                sourceAttemptKey: workerId,
            })
        );
        await application.ingestLocalCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[12]!,
                eventId: "explicit-occurrence-ended",
            })
        );

        const finalized = await application.getCall({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            callId: started.id,
        });
        expect(finalized.status).toBe("completed");
        expect(finalized.capture.desiredMode).toBe("stopped");
        expect(finalized.transcript).toHaveLength(1);
        expect(finalized.viewerCapabilities.canRequestEnrichment).toBe(true);
    });

    it("projects the canonical note as one workspace file and enforces private/company boundaries", async () => {
        const fixtures = await insertFixtures(testDb);
        const { application } = createApplication(testDb);
        const started = await startWithWorker(application);
        if (!started?.note) throw new Error("expected canonical note");
        const ownerQuery = {
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
        };
        const edited = await application.execute(
            CallNotesCommandSchema.parse({
                ...CALL_NOTES_START_COMMAND,
                requestId: "workspace-file-note-edit",
                kind: "update_note",
                callId: started.id,
                baseRevision: started.note.revision,
                title: "Canonical workspace note",
                contentMarkdown: "Owner-authored rollout guidance",
                contentRich: {
                    type: "doc",
                    content: [
                        {
                            type: "paragraph",
                            content: [{ type: "text", text: "Owner-authored rollout guidance" }],
                        },
                    ],
                },
            })
        );
        const sharedFiles = await listWorkspaceCallNoteFiles(
            {
                ...ownerQuery,
                actorUserId: CALL_NOTES_FIXTURE_IDS.otherUserId,
            },
            testDb.db
        );
        expect(sharedFiles).toEqual([
            expect.objectContaining({
                callId: started.id,
                noteId: started.note.documentNoteId,
                title: "Canonical workspace note",
                preview: "Owner-authored rollout guidance",
                revision: edited!.note!.revision,
                visibility: "company",
            }),
        ]);
        await application.execute(
            CallNotesCommandSchema.parse({
                ...CALL_NOTES_START_COMMAND,
                requestId: "workspace-file-make-private",
                kind: "set_note_visibility",
                callId: started.id,
                visibility: "private",
            })
        );
        await expect(
            listWorkspaceCallNoteFiles(
                {
                    ...ownerQuery,
                    actorUserId: CALL_NOTES_FIXTURE_IDS.otherUserId,
                },
                testDb.db
            )
        ).resolves.toEqual([]);
        await expect(listWorkspaceCallNoteFiles(ownerQuery, testDb.db)).resolves.toEqual([
            expect.objectContaining({
                callId: started.id,
                noteId: started.note.documentNoteId,
                visibility: "private",
            }),
        ]);
        await expectApplicationCode(
            listWorkspaceCallNoteFiles(
                {
                    ...ownerQuery,
                    actorUserId: "user_beta_owner",
                },
                testDb.db
            ),
            "forbidden"
        );
        await expect(
            listWorkspaceCallNoteFiles(
                {
                    companyId: fixtures.betaCompanyId.toString(),
                    actorUserId: "user_beta_owner",
                },
                testDb.db
            )
        ).resolves.toEqual([]);
        const deleting = await application.getCall({ ...ownerQuery, callId: started.id });
        expect(deleting.viewerCapabilities.canDelete).toBe(true);
        await application.execute(
            CallNotesCommandSchema.parse({
                ...CALL_NOTES_START_COMMAND,
                kind: "delete_call",
                requestId: "delete-workspace-file",
                callId: started.id,
            })
        );
        await expect(listWorkspaceCallNoteFiles(ownerQuery, testDb.db)).resolves.toEqual([]);
        await expectApplicationCode(
            application.getCall({ ...ownerQuery, callId: started.id }),
            "not_found"
        );
    });
});
