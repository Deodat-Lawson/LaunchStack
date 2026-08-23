import { and, eq, getTableName, sql } from "drizzle-orm";

import {
    CALL_NOTES_CAPTURE_EVENTS,
    CALL_NOTES_DETECTED_CANDIDATE,
    CALL_NOTES_DISMISS_COMMAND,
    CALL_NOTES_ENRICHMENT_PROPOSAL,
    CALL_NOTES_FIXTURE_IDS,
    CALL_NOTES_START_COMMAND,
    CallNotesApplicationError,
    CallNotesCommandSchema,
    CaptureEventSchema,
    CompleteEnrichmentInputSchema,
    DetectedCallCandidateSchema,
    runCallNotesVerticalTracer,
    type CallListQuery,
    type CallNotesApplication,
    type CallNotesCommand,
    type CallNotesDocumentNoteStore,
    type CallNotesIdSource,
    type CaptureEvent,
    type DetectedCallCandidate,
    type KnowledgeNote,
} from "@launchstack/features/call-notes";

// Keep the integration test focused on the injected migrated database. The
// production engine eagerly imports env.ts, which is not a Jest-loadable module
// under this test transform; the adapter still uses getEngine().db by default
// when no database is supplied.
jest.mock("~/server/engine", () => ({
    getEngine: jest.fn(),
}));

import {
    createWebCallNotesApplication,
    createWebCallNotesDocumentNoteStore,
} from "~/server/call-notes/application";
import { documentNotes } from "~/server/db/schema";

import { createCallNotesTestDatabase, type CallNotesTestDatabase } from "./testDb";

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;

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

interface RecordingKnowledgeSink {
    notes: KnowledgeNote[];
    removed: Array<{ companyId: string; callId: string }>;
    upsertAttempts: number;
    removeAttempts: number;
    failNextUpsert(): void;
    failNextRemove(): void;
    get(companyId: string, callId: string): Promise<KnowledgeNote | null>;
    upsert(note: KnowledgeNote): Promise<void>;
    remove(companyId: string, callId: string): Promise<void>;
}

interface KnowledgeSinkOptions {
    failUpserts?: number;
    failRemoves?: number;
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

    await testDb.db.execute(sql`
        INSERT INTO "pdr_ai_v2_call_notes_zoom_connections"
            ("id", "company_id", "user_id", "zoom_account_id", "zoom_user_id",
             "encrypted_access_token", "encrypted_refresh_token", "scopes", "status")
        VALUES
            (${CALL_NOTES_FIXTURE_IDS.authorizationRef}, ${alphaCompanyId},
             ${CALL_NOTES_FIXTURE_IDS.ownerUserId}, 'zoom-account-fixture',
             'zoom-owner-fixture', 'encrypted-access-fixture',
             'encrypted-refresh-fixture', ARRAY['meeting:read']::text[], 'active')
    `);

    return {
        alphaCompanyId,
        betaCompanyId,
        ownerPk,
        teammatePk,
        adminPk,
        outsiderPk,
    };
}

function createKnowledgeSink(options: KnowledgeSinkOptions = {}): RecordingKnowledgeSink {
    const byCall = new Map<string, KnowledgeNote>();
    const notes: KnowledgeNote[] = [];
    const removed: Array<{ companyId: string; callId: string }> = [];
    let failuresBeforeUpsert = options.failUpserts ?? 0;
    let failuresBeforeRemove = options.failRemoves ?? 0;
    let upsertAttempts = 0;
    let removeAttempts = 0;

    return {
        notes,
        removed,
        get upsertAttempts() {
            return upsertAttempts;
        },
        get removeAttempts() {
            return removeAttempts;
        },
        failNextUpsert() {
            failuresBeforeUpsert += 1;
        },
        failNextRemove() {
            failuresBeforeRemove += 1;
        },
        async get(companyId, callId) {
            return byCall.get(`${companyId}:${callId}`) ?? null;
        },
        async upsert(note) {
            upsertAttempts += 1;
            if (failuresBeforeUpsert > 0) {
                failuresBeforeUpsert -= 1;
                throw new Error("fixture knowledge upsert transient failure");
            }
            byCall.set(`${note.companyId}:${note.callId}`, note);
            notes.push(note);
        },
        async remove(companyId, callId) {
            removeAttempts += 1;
            if (failuresBeforeRemove > 0) {
                failuresBeforeRemove -= 1;
                throw new Error("fixture knowledge remove transient failure");
            }
            byCall.delete(`${companyId}:${callId}`);
            removed.push({ companyId, callId });
        },
    };
}

interface ApplicationTestOptions {
    knowledge?: RecordingKnowledgeSink;
    ids?: CallNotesIdSource;
    documentNotes?: CallNotesDocumentNoteStore;
}

function createApplication(
    testDb: Pick<CallNotesTestDatabase, "db">,
    options: ApplicationTestOptions = {}
): {
    application: CallNotesApplication;
    knowledge: RecordingKnowledgeSink;
    detectedQueries: CallListQuery[];
} {
    const knowledge = options.knowledge ?? createKnowledgeSink();
    const detectedQueries: CallListQuery[] = [];
    const otherCandidate = DetectedCallCandidateSchema.parse({
        ...CALL_NOTES_DETECTED_CANDIDATE,
        occurrenceKey: "zoom-occurrence-other",
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
        knowledgeSink: knowledge,
        documentNotes: options.documentNotes,
        detectedCalls: {
            async list(query) {
                detectedQueries.push(query);
                return query.companyId === CALL_NOTES_FIXTURE_IDS.companyId ? candidates : [];
            },
        },
        clock: { now: () => new Date(FIXED_NOW) },
        ids,
    });

    return { application, knowledge, detectedQueries };
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
    });

    afterEach(async () => {
        if (testDb) await testDb.close();
    });

    it("runs the real application through the shared vertical tracer and preserves durable boundaries", async () => {
        const fixtures = await insertFixtures(testDb);
        expect(fixtures.alphaCompanyId).toBe(1n);
        expect(fixtures.betaCompanyId).toBe(2n);

        const { application, knowledge, detectedQueries } = createApplication(testDb);
        const detectedBefore = await application.listDetectedCalls({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            limit: 50,
        });
        expect(detectedBefore.map(candidate => candidate.occurrenceKey)).toEqual([
            CALL_NOTES_FIXTURE_IDS.occurrenceKey,
            "zoom-occurrence-other",
        ]);

        await application.execute(CALL_NOTES_DISMISS_COMMAND);
        const detectedAfterDismiss = await application.listDetectedCalls({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            limit: 50,
        });
        expect(detectedAfterDismiss.map(candidate => candidate.occurrenceKey)).toEqual([
            "zoom-occurrence-other",
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
        expect(teammateDetected.map(candidate => candidate.occurrenceKey)).toEqual([
            CALL_NOTES_FIXTURE_IDS.occurrenceKey,
            "zoom-occurrence-other",
        ]);

        const firstStart = await application.execute(CALL_NOTES_START_COMMAND);
        const replayedStart = await application.execute(CALL_NOTES_START_COMMAND);
        expect(firstStart?.id).toBeTruthy();
        expect(replayedStart?.id).toBe(firstStart?.id);

        const finalSnapshot = await runCallNotesVerticalTracer(application, knowledge);
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
        expect(finalSnapshot.bookmarks).toHaveLength(1);
        expect(finalSnapshot.note?.knowledgeIncluded).toBe(true);
        expect(knowledge.notes.at(-1)).toMatchObject({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            callId: finalSnapshot.id,
            revision: finalSnapshot.note?.revision,
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

        await expectApplicationCode(
            application.execute(
                CallNotesCommandSchema.parse({
                    ...CALL_NOTES_START_COMMAND,
                    requestId: "owner-delete-completed",
                    kind: "delete_call",
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
        expect(knowledge.removed).toContainEqual({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            callId: finalSnapshot.id,
        });
        expect(await countTranscriptSegments(testDb)).toBe(0);
    });

    it("redacts private enrichment and retries deletion through a surviving receipt", async () => {
        await insertFixtures(testDb);
        const knowledge = createKnowledgeSink();
        const { application } = createApplication(testDb, { knowledge });
        const finalSnapshot = await runCallNotesVerticalTracer(application, knowledge);

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
        expect(owner.enrichment?.proposal?.contentMarkdown).toBe(
            CALL_NOTES_ENRICHMENT_PROPOSAL.contentMarkdown
        );

        const removeAttemptsBeforeDelete = knowledge.removeAttempts;
        knowledge.failNextRemove();
        const deleteCommand = CallNotesCommandSchema.parse({
            ...CALL_NOTES_START_COMMAND,
            requestId: "delete-retry-after-sink-failure",
            kind: "delete_call",
            actorUserId: "user_admin",
            callId: finalSnapshot.id,
        });
        await expectApplicationCode(application.execute(deleteCommand), "unavailable");
        expect(knowledge.removeAttempts).toBe(removeAttemptsBeforeDelete + 1);

        const failedDeleteReceipt = await testDb.db.execute(sql`
            SELECT "status", "call_id"
            FROM "pdr_ai_v2_call_notes_work_items"
            WHERE "company_id" = ${BigInt(CALL_NOTES_FIXTURE_IDS.companyId)}
              AND "kind" = 'finalize'
              AND "idempotency_key" = ${deleteCommand.requestId}
        `);
        expect(failedDeleteReceipt).toHaveLength(1);
        expect(failedDeleteReceipt[0]?.status).toBe("failed");
        expect(failedDeleteReceipt[0]?.call_id).toBeNull();

        const retriedDelete = await application.execute(deleteCommand);
        expect(retriedDelete).toBeNull();
        expect(knowledge.removeAttempts).toBe(removeAttemptsBeforeDelete + 2);
        expect(await knowledge.get(CALL_NOTES_FIXTURE_IDS.companyId, finalSnapshot.id)).toBeNull();
        await expectApplicationCode(
            application.getCall({
                companyId: CALL_NOTES_FIXTURE_IDS.companyId,
                actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
                callId: finalSnapshot.id,
            }),
            "not_found"
        );

        const completedDeleteReceipt = await testDb.db.execute(sql`
            SELECT "status", "call_id"
            FROM "pdr_ai_v2_call_notes_work_items"
            WHERE "company_id" = ${BigInt(CALL_NOTES_FIXTURE_IDS.companyId)}
              AND "kind" = 'finalize'
              AND "idempotency_key" = ${deleteCommand.requestId}
        `);
        expect(completedDeleteReceipt[0]?.status).toBe("completed");
        expect(completedDeleteReceipt[0]?.call_id).toBeNull();
    });

    it("retries a private-note sink removal after the persisted flag is cleared", async () => {
        await insertFixtures(testDb);
        const knowledge = createKnowledgeSink();
        const { application } = createApplication(testDb, { knowledge });
        const finalSnapshot = await runCallNotesVerticalTracer(application, knowledge);
        const removeAttemptsBeforeRetry = knowledge.removeAttempts;
        knowledge.failNextRemove();

        const command = CallNotesCommandSchema.parse({
            ...CALL_NOTES_START_COMMAND,
            requestId: "private-removal-retry",
            kind: "set_note_visibility",
            callId: finalSnapshot.id,
            visibility: "private",
        });
        await expectApplicationCode(application.execute(command), "unavailable");
        const persistedAfterFailure = await testDb.db.execute(sql`
            SELECT "note_visibility", "knowledge_included"
            FROM "pdr_ai_v2_call_notes_calls"
            WHERE "id" = ${finalSnapshot.id}
        `);
        expect(persistedAfterFailure[0]).toMatchObject({
            note_visibility: "private",
            knowledge_included: false,
        });

        const replay = await application.execute(command);
        expect(replay?.note?.visibility).toBe("private");
        expect(await knowledge.get(CALL_NOTES_FIXTURE_IDS.companyId, finalSnapshot.id)).toBeNull();
        expect(knowledge.removeAttempts).toBe(removeAttemptsBeforeRetry + 2);
    });
    it("validates authorization before converging an already-live occurrence", async () => {
        await insertFixtures(testDb);
        const { application } = createApplication(testDb);
        const started = await application.execute(CALL_NOTES_START_COMMAND);
        if (!started) throw new Error("expected start snapshot");

        await expectApplicationCode(
            application.execute(
                CallNotesCommandSchema.parse({
                    ...CALL_NOTES_START_COMMAND,
                    requestId: "teammate-start-live-occurrence",
                    actorUserId: CALL_NOTES_FIXTURE_IDS.otherUserId,
                    authorizationRef: "missing-teammate-connection",
                })
            ),
            "forbidden"
        );
        const calls = await application.listCalls({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.otherUserId,
            limit: 10,
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.id).toBe(started.id);
    });

    it("deletes a just-created document Note when Call persistence fails", async () => {
        await insertFixtures(testDb);
        const productionDocumentNotes = createWebCallNotesDocumentNoteStore(testDb.db);
        const failingDocumentNotes: CallNotesDocumentNoteStore = {
            ...productionDocumentNotes,
            async create(input) {
                const note = await productionDocumentNotes.create(input);
                await testDb.db.execute(sql`
                    DELETE FROM "pdr_ai_v2_call_notes_zoom_connections"
                    WHERE "id" = ${CALL_NOTES_FIXTURE_IDS.authorizationRef}
                `);
                return note;
            },
        };
        const { application } = createApplication(testDb, {
            documentNotes: failingDocumentNotes,
        });

        const command = parseStartCaptureCommand({
            ...CALL_NOTES_START_COMMAND,
            requestId: "start-orphan-cleanup",
        });
        await expectApplicationCode(application.execute(command), "unavailable");

        const orphanedNotes = await testDb.db
            .select({ id: documentNotes.id })
            .from(documentNotes)
            .where(
                and(
                    eq(documentNotes.companyId, CALL_NOTES_FIXTURE_IDS.companyId),
                    eq(documentNotes.userId, CALL_NOTES_FIXTURE_IDS.ownerUserId),
                    eq(documentNotes.title, command.title ?? "Zoom call")
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

    it("replays an included Note edit after a transient knowledge upsert failure", async () => {
        await insertFixtures(testDb);
        const knowledge = createKnowledgeSink();
        const { application } = createApplication(testDb, { knowledge });
        const started = await application.execute(CALL_NOTES_START_COMMAND);
        if (!started?.note) throw new Error("expected started Note");

        const firstEdit = parseUpdateNoteCommand({
            ...CALL_NOTES_START_COMMAND,
            requestId: "included-edit-v1",
            kind: "update_note",
            callId: started.id,
            baseRevision: started.note.revision,
            title: started.note.title,
            contentMarkdown: "indexed revision one",
            contentRich: { type: "doc", content: [] },
        });
        const firstRevision = await application.execute(firstEdit);
        expect(firstRevision?.note?.revision).toBe(1);
        await application.execute(
            CallNotesCommandSchema.parse({
                ...CALL_NOTES_START_COMMAND,
                requestId: "include-note-v1",
                kind: "set_knowledge_inclusion",
                callId: started.id,
                included: true,
            })
        );
        expect((await knowledge.get(CALL_NOTES_FIXTURE_IDS.companyId, started.id))?.revision).toBe(
            1
        );

        knowledge.failNextUpsert();
        const secondEdit = parseUpdateNoteCommand({
            ...CALL_NOTES_START_COMMAND,
            requestId: "included-edit-v2",
            kind: "update_note",
            callId: started.id,
            baseRevision: 1,
            title: started.note.title,
            contentMarkdown: "indexed revision two",
            contentRich: { type: "doc", content: [] },
        });
        await expectApplicationCode(application.execute(secondEdit), "unavailable");
        const committed = await application.getCall({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            callId: started.id,
        });
        expect(committed.note?.revision).toBe(2);
        expect(committed.note?.contentMarkdown).toBe("indexed revision two");
        expect((await knowledge.get(CALL_NOTES_FIXTURE_IDS.companyId, started.id))?.revision).toBe(
            1
        );

        const replay = await application.execute(secondEdit);
        expect(replay?.note?.revision).toBe(2);
        expect(replay?.note?.contentMarkdown).toBe("indexed revision two");
        expect((await knowledge.get(CALL_NOTES_FIXTURE_IDS.companyId, started.id))?.revision).toBe(
            2
        );
    });

    it("replays an included enrichment acceptance after a transient knowledge upsert failure", async () => {
        await insertFixtures(testDb);
        const knowledge = createKnowledgeSink();
        const { application } = createApplication(testDb, { knowledge });
        const started = await application.execute(CALL_NOTES_START_COMMAND);
        if (!started?.note) throw new Error("expected started Note");

        const firstEdit = parseUpdateNoteCommand({
            ...CALL_NOTES_START_COMMAND,
            requestId: "included-acceptance-base",
            kind: "update_note",
            callId: started.id,
            baseRevision: started.note.revision,
            title: started.note.title,
            contentMarkdown: "base indexed content",
            contentRich: { type: "doc", content: [] },
        });
        await application.execute(firstEdit);
        await application.execute(
            CallNotesCommandSchema.parse({
                ...CALL_NOTES_START_COMMAND,
                requestId: "include-before-acceptance",
                kind: "set_knowledge_inclusion",
                callId: started.id,
                included: true,
            })
        );

        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CALL_NOTES_CAPTURE_EVENTS[0]!
        );
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CALL_NOTES_CAPTURE_EVENTS[3]!
        );
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

        knowledge.failNextUpsert();
        const acceptance = parseAcceptEnrichmentCommand({
            ...CALL_NOTES_START_COMMAND,
            requestId: "acceptance-with-transient-index-failure",
            kind: "accept_enrichment",
            callId: started.id,
            enrichmentRunId: ready.enrichment.id,
            contentMarkdown: CALL_NOTES_ENRICHMENT_PROPOSAL.contentMarkdown,
            contentRich: CALL_NOTES_ENRICHMENT_PROPOSAL.contentRich,
        });
        await expectApplicationCode(application.execute(acceptance), "unavailable");
        const committed = await application.getCall({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            callId: started.id,
        });
        expect(committed.note?.revision).toBe(2);
        expect(committed.enrichment?.status).toBe("accepted");
        expect((await knowledge.get(CALL_NOTES_FIXTURE_IDS.companyId, started.id))?.revision).toBe(
            1
        );

        const replay = await application.execute(acceptance);
        expect(replay?.note?.revision).toBe(2);
        expect(replay?.enrichment?.status).toBe("accepted");
        expect((await knowledge.get(CALL_NOTES_FIXTURE_IDS.companyId, started.id))?.revision).toBe(
            2
        );
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
                contentMarkdown: CALL_NOTES_ENRICHMENT_PROPOSAL.contentMarkdown,
                contentRich: CALL_NOTES_ENRICHMENT_PROPOSAL.contentRich,
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
                    CALL_NOTES_ENRICHMENT_PROPOSAL.contentMarkdown
                );
                expect(revisions).toEqual([
                    expect.objectContaining({ revision: 0, content_markdown: "" }),
                    expect.objectContaining({
                        revision: 1,
                        content_markdown: CALL_NOTES_ENRICHMENT_PROPOSAL.contentMarkdown,
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

    it("claims concurrent duplicate provider events before applying participants and gaps", async () => {
        await insertFixtures(testDb);
        let idSequence = 0;
        const ids: CallNotesIdSource = {
            next(prefix) {
                idSequence += 1;
                return `${prefix}-duplicate-${idSequence}`;
            },
        };
        const appA = createApplication(testDb, { ids }).application;
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
                  AND "provider_participant_key" = 'zoom-user-owner'
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
        const started = await application.execute(CALL_NOTES_START_COMMAND);
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
                code: "provider_stream_lost",
                occurredAt: "2026-08-15T14:02:00.000Z",
            })
        );
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[11]!,
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
                providerEventKey: "late-first-transcript-provider-key",
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
        const started = await application.execute(CALL_NOTES_START_COMMAND);
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
                attemptKey: CALL_NOTES_FIXTURE_IDS.secondAttemptKey,
                streamKey: "zoom-stream-2",
                occurredAt: "2026-08-15T14:04:00.000Z",
            })
        );
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CaptureEventSchema.parse({
                ...CALL_NOTES_CAPTURE_EVENTS[0]!,
                eventId: "transport-interrupted-attempt-two",
                attemptKey: CALL_NOTES_FIXTURE_IDS.secondAttemptKey,
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
                attemptKey: CALL_NOTES_FIXTURE_IDS.secondAttemptKey,
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

    it("associates participant leaves and transcript packets by provider session", async () => {
        await insertFixtures(testDb);
        const { application } = createApplication(testDb);
        const started = await application.execute(CALL_NOTES_START_COMMAND);
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
                    providerParticipantKey: "reused-participant-key",
                    providerSessionKey: "provider-session-one",
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
                    providerParticipantKey: "reused-participant-key",
                    providerSessionKey: "provider-session-two",
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
                    providerParticipantKey: "reused-participant-key",
                    providerSessionKey: "provider-session-one",
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
                participant: {
                    providerParticipantKey: "reused-participant-key",
                    providerSessionKey: "provider-session-one",
                    displayName: "Reused Participant",
                },
                sourcePacketHash:
                    "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            })
        );

        const participants = await testDb.db.execute(sql`
            SELECT "id", "provider_session_key", "left_at"
            FROM "pdr_ai_v2_call_notes_participants"
            WHERE "call_id" = ${started.id}
              AND "provider_participant_key" = 'reused-participant-key'
            ORDER BY "observed_at"
        `);
        expect(participants).toHaveLength(2);
        expect(participants[0]?.provider_session_key).toBe("provider-session-one");
        expect(participants[0]?.left_at).toBeTruthy();
        expect(participants[1]?.provider_session_key).toBe("provider-session-two");
        expect(participants[1]?.left_at).toBeNull();
        const transcript = await testDb.db.execute(sql`
            SELECT "participant_id"
            FROM "pdr_ai_v2_call_notes_transcript_segments"
            WHERE "call_id" = ${started.id}
        `);
        expect(transcript[0]?.participant_id).toBe(participants[0]?.id);
    });

    it("does not let a provider replay replace immutable evidence or cross company boundaries", async () => {
        const fixtures = await insertFixtures(testDb);
        const { application, knowledge } = createApplication(testDb);
        const started = await application.execute(CALL_NOTES_START_COMMAND);
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
            occurrenceKey: "zoom-occurrence-cross-company",
        });
        await expectApplicationCode(
            application.ingestCaptureEvent(fixtures.betaCompanyId.toString(), otherCompanyEvent),
            "not_found"
        );
        expect(await knowledge.get(CALL_NOTES_FIXTURE_IDS.companyId, started.id)).toBeNull();
    });
});
