import { and, eq } from "drizzle-orm";

import type { DbClient } from "@launchstack/core/db";
import {
    CallNoteSchema,
    CallNotesApplicationError,
    createPostgresCallNotesApplication,
    type CallNotesApplication,
    type CallNotesApplicationOptions,
    type CallNotesDocumentNoteExecutor,
    type CallNotesDocumentNoteRecord,
    type CallNotesDocumentNoteStore,
    type CallNotesMembershipRole,
    type CallNotesMembershipStore,
} from "@launchstack/features/call-notes";

import { getEngine } from "~/server/engine";
import { documentNotes, userCompanyMemberships, users } from "~/server/db/schema";
import { LocalDetectedCallSource } from "./detected-calls";
import { createKnowledgeNoteSink } from "./knowledge-note-sink";

export type { CallNotesApplication } from "@launchstack/features/call-notes";
export { CallNotesApplicationError } from "@launchstack/features/call-notes";

/**
 * The web host owns identity/membership and document-note storage. The
 * knowledge and detected-call boundaries belong to their respective lanes and
 * are deliberately required here rather than silently defaulted.
 */
export type WebCallNotesApplicationOptions = Omit<
    CallNotesApplicationOptions,
    "db" | "memberships" | "documentNotes"
> & {
    db?: DbClient;
    memberships?: CallNotesMembershipStore;
    documentNotes?: CallNotesDocumentNoteStore;
};

const DOCUMENT_NOTE_CONTENT_SCHEMA = CallNoteSchema.pick({
    title: true,
    contentMarkdown: true,
    contentRich: true,
});

function isMembershipRole(value: string): value is CallNotesMembershipRole {
    return value === "owner" || value === "admin" || value === "editor";
}

function asDocumentNoteRecord(row: {
    id: number;
    title: string | null;
    contentMarkdown: string | null;
    contentRich: unknown;
}): CallNotesDocumentNoteRecord {
    if (!Number.isInteger(row.id) || row.id <= 0) {
        throw new Error("document_notes returned an invalid note id");
    }

    const parsed = DOCUMENT_NOTE_CONTENT_SCHEMA.safeParse({
        title: row.title ?? "",
        contentMarkdown: row.contentMarkdown ?? "",
        contentRich: row.contentRich ?? {},
    });
    if (!parsed.success) {
        throw new Error("document_notes returned invalid note content");
    }

    return {
        id: row.id,
        ...parsed.data,
    };
}

function isConfiguredCallNotesApplication(
    value: CallNotesApplication | WebCallNotesApplicationOptions
): value is CallNotesApplication {
    return "execute" in value && typeof value.execute === "function";
}

export function createWebCallNotesMembershipStore(
    db: DbClient = getEngine().db
): CallNotesMembershipStore {
    return {
        async getRole(companyId, actorUserId) {
            const [row] = await db
                .select({ role: userCompanyMemberships.role })
                .from(userCompanyMemberships)
                .innerJoin(users, eq(users.id, userCompanyMemberships.userId))
                .where(
                    and(
                        eq(userCompanyMemberships.companyId, BigInt(companyId)),
                        eq(users.userId, actorUserId)
                    )
                )
                .limit(1);

            if (!row || !isMembershipRole(row.role)) {
                return null;
            }
            return row.role;
        },
    };
}

export function createWebCallNotesDocumentNoteStore(
    db: DbClient = getEngine().db
): CallNotesDocumentNoteStore {
    return {
        async create(input, executor: CallNotesDocumentNoteExecutor = db) {
            const [row] = await executor
                .insert(documentNotes)
                .values({
                    userId: input.userId,
                    companyId: input.companyId,
                    title: input.title,
                    contentMarkdown: input.contentMarkdown,
                    contentRich: input.contentRich,
                })
                .returning({
                    id: documentNotes.id,
                    title: documentNotes.title,
                    contentMarkdown: documentNotes.contentMarkdown,
                    contentRich: documentNotes.contentRich,
                });

            if (!row) {
                throw new Error("document_notes insert returned no row");
            }
            return asDocumentNoteRecord(row);
        },

        async get(id, executor: CallNotesDocumentNoteExecutor = db) {
            const [row] = await executor
                .select({
                    id: documentNotes.id,
                    title: documentNotes.title,
                    contentMarkdown: documentNotes.contentMarkdown,
                    contentRich: documentNotes.contentRich,
                })
                .from(documentNotes)
                .where(eq(documentNotes.id, id))
                .limit(1);

            return row ? asDocumentNoteRecord(row) : null;
        },

        async update(id, input, executor: CallNotesDocumentNoteExecutor = db) {
            const [row] = await executor
                .update(documentNotes)
                .set({
                    title: input.title,
                    contentMarkdown: input.contentMarkdown,
                    contentRich: input.contentRich,
                })
                .where(eq(documentNotes.id, id))
                .returning({
                    id: documentNotes.id,
                    title: documentNotes.title,
                    contentMarkdown: documentNotes.contentMarkdown,
                    contentRich: documentNotes.contentRich,
                });

            if (!row) {
                throw new Error("document_notes row not found");
            }
            return asDocumentNoteRecord(row);
        },

        async delete(id, executor: CallNotesDocumentNoteExecutor = db) {
            await executor.delete(documentNotes).where(eq(documentNotes.id, id));
        },
    };
}

export function createWebCallNotesApplication(
    options: WebCallNotesApplicationOptions
): CallNotesApplication {
    if (!options.knowledgeSink || !options.detectedCalls) {
        throw new CallNotesApplicationError(
            "unavailable",
            "Call Notes external dependencies are not configured"
        );
    }

    const db = options.db ?? getEngine().db;

    return createPostgresCallNotesApplication({
        ...options,
        db,
        memberships: options.memberships ?? createWebCallNotesMembershipStore(db),
        documentNotes: options.documentNotes ?? createWebCallNotesDocumentNoteStore(db),
    });
}

// Keep the service in its module: separate Next route bundles can have distinct
// error constructors. Sharing an instance through globalThis crosses that boundary
// and turns domain 403/404 errors into unrecognized 503 responses.
let configuredApplication: CallNotesApplication | undefined;

/** Configure this module's production application, or a test application. */
export function configureWebCallNotesApplication(application: CallNotesApplication): void;
export function configureWebCallNotesApplication(
    options: WebCallNotesApplicationOptions
): CallNotesApplication;
export function configureWebCallNotesApplication(
    value: CallNotesApplication | WebCallNotesApplicationOptions
): CallNotesApplication | void {
    const application = isConfiguredCallNotesApplication(value)
        ? value
        : createWebCallNotesApplication(value);

    configuredApplication = application;
    return application;
}

export function getWebCallNotesApplication(): CallNotesApplication {
    if (configuredApplication) return configuredApplication;

    const application = createWebCallNotesApplication({
        knowledgeSink: createKnowledgeNoteSink(),
        detectedCalls: new LocalDetectedCallSource(),
    });
    configuredApplication = application;
    return application;
}

export function callNotesErrorStatus(error: unknown): number {
    if (!(error instanceof CallNotesApplicationError)) {
        return 503;
    }

    switch (error.code) {
        case "not_found":
            return 404;
        case "forbidden":
            return 403;
        case "conflict":
            return 409;
        case "invalid_transition":
            return 422;
        case "unavailable":
            return 503;
    }
    return 503;
}

export function callNotesErrorResponse(error: unknown): Response {
    const status = callNotesErrorStatus(error);
    if (error instanceof CallNotesApplicationError) {
        return Response.json({ error: error.message, code: error.code }, { status });
    }

    return Response.json({ error: "Call Notes is unavailable" }, { status });
}
