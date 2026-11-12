/**
 * The follow-up note as a durable job: the worker's side of
 * `assistant-conversations/follow-up.requested` (`./follow-up-queue` sends
 * it; `~/server/inngest/functions/assistantConversationFollowUp` runs these
 * two steps).
 *
 * The event names a save, not its transcript, so the job reads the
 * transcript back from the saved document: the newest versions' Markdown
 * files, parsed with the conversation viewer's parser, and taken only when
 * they hash to the save's content hash — the same title-and-turns hash the
 * save stored, so what the model reads is exactly what was saved. The
 * person's document scope is rebuilt from their membership, as the MCP
 * request built it.
 *
 * Errors: `FollowUpPermanentError` (and the chat-configuration errors, the
 * AI allowance among them) will not get better on a retry; the job fails
 * those at once. Anything else — a model endpoint's bad minute, a storage or
 * database blip — is retried. Whichever way the job gives up, the row ends
 * `failed` with the error, as the in-process path leaves it.
 */
import { ChatConfigurationError } from "@launchstack/llm";
import { document, documentVersions } from "@launchstack/store/schema";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { resolveMemberContext } from "~/lib/require-workspace-context";
import { parseSessionTranscript } from "~/lib/session-transcript";
import { fetchFile } from "~/lib/storage";
import { db } from "~/server/db";
import { ASSISTANT_CLIENTS, assistantConversations } from "~/server/db/schema";

import {
    commitFollowUpNote,
    indexFollowUpNote,
    type FollowUpOutcome,
    type FollowUpTarget,
} from "./follow-up";
import type { FollowUpPromptInput } from "./follow-up-model";
import type { FollowUpEventData } from "./follow-up-queue";
import { conversationContentHash } from "./render";
import type { NormalizedMessage } from "./validate";

/** A failure a retry cannot fix. */
export class FollowUpPermanentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FollowUpPermanentError";
    }
}

export function isPermanentFollowUpError(error: unknown): boolean {
    // ChatConfigurationError covers an unusable workspace model and the AI allowance too.
    return error instanceof FollowUpPermanentError || error instanceof ChatConfigurationError;
}

export const FollowUpEventDataSchema = z.object({
    conversationRowId: z.number().int().positive(),
    documentId: z.number().int().positive(),
    companyId: z.string().regex(/^\d+$/),
    authUserId: z.string().min(1),
    title: z.string().min(1),
    family: z.enum(ASSISTANT_CLIENTS),
    contentHash: z.string().min(1),
});

export function followUpTargetFromEvent(data: FollowUpEventData): FollowUpTarget {
    return { ...data, companyId: BigInt(data.companyId) };
}

const MEMBER_GONE =
    "The person who saved this conversation is no longer an active member of this workspace.";
const TRANSCRIPT_UNREADABLE =
    "The saved conversation could not be read back to write its follow-up.";
/** Versions read back, newest first; the save's own is the newest unless another save followed. */
const VERSIONS_TO_TRY = 3;

/** The row as the job sees it: `stale` when a newer save (or a delete) moved it on. */
async function rowState(target: FollowUpTarget): Promise<"stale" | "done" | "pending"> {
    const [row] = await db
        .select({
            contentHash: assistantConversations.contentHash,
            followUpStatus: assistantConversations.followUpStatus,
        })
        .from(assistantConversations)
        .where(
            and(
                eq(assistantConversations.id, target.conversationRowId),
                eq(assistantConversations.companyId, target.companyId)
            )
        )
        .limit(1);
    if (!row || row.contentHash !== target.contentHash) return "stale";
    // A repeated event for a save whose note is already written.
    return row.followUpStatus === "done" ? "done" : "pending";
}

/**
 * The saved turns of this save, read back from the document's stored
 * Markdown. Null when no recent version hashes to the save's content hash.
 * Throws when a file could not be fetched and none matched (worth a retry).
 */
export async function loadSavedMessages(
    target: FollowUpTarget
): Promise<NormalizedMessage[] | null> {
    const versions = await db
        .select({ url: documentVersions.url })
        .from(documentVersions)
        .innerJoin(document, eq(document.id, documentVersions.documentId))
        .where(
            and(
                eq(documentVersions.documentId, BigInt(target.documentId)),
                eq(document.companyId, target.companyId)
            )
        )
        .orderBy(desc(documentVersions.versionNumber))
        .limit(VERSIONS_TO_TRY);

    let fetchError: Error | null = null;
    for (const { url } of versions) {
        let markdown: string;
        try {
            const response = await fetchFile(url);
            if (!response.ok)
                throw new Error(`Reading the saved transcript: HTTP ${response.status}`);
            markdown = await response.text();
        } catch (error) {
            fetchError = error instanceof Error ? error : new Error(String(error));
            continue;
        }
        const parsed = parseSessionTranscript(markdown, { format: "assistant-conversation" });
        const messages: NormalizedMessage[] = parsed.segments.flatMap(segment =>
            segment.kind === "user" || segment.kind === "assistant"
                ? [{ role: segment.kind, content: segment.text, at: segment.at ?? null }]
                : []
        );
        const hash = conversationContentHash({ title: parsed.title ?? "", messages });
        if (hash === target.contentHash) return messages;
    }
    if (fetchError) throw fetchError;
    return null;
}

export type PreparedFollowUp =
    | { outcome: "stale" | "done" }
    | { outcome: "ready"; markdown: string };

/**
 * Step one: decide whether this save still needs its note, read its
 * transcript back and have the model write the note body. `generateMarkdown`
 * is the model call; the job wraps it in the workspace's chat models.
 */
export async function prepareFollowUp(
    target: FollowUpTarget,
    generateMarkdown: (input: FollowUpPromptInput) => Promise<string>
): Promise<PreparedFollowUp> {
    const state = await rowState(target);
    if (state !== "pending") return { outcome: state };

    if (!(await resolveMemberContext(target.authUserId, target.companyId))) {
        throw new FollowUpPermanentError(MEMBER_GONE);
    }

    const messages = await loadSavedMessages(target);
    if (!messages) {
        // A newer save may have landed while the files were read.
        if ((await rowState(target)) === "stale") return { outcome: "stale" };
        throw new FollowUpPermanentError(TRANSCRIPT_UNREADABLE);
    }

    const markdown = await generateMarkdown({
        title: target.title,
        family: target.family,
        messages,
    });
    return { outcome: "ready", markdown };
}

/**
 * Step two: write (or refresh) the note while the row still has this save's
 * hash, then index it in the saver's document scope. Idempotent: a retry
 * after a commit refreshes the same note in place.
 */
export async function finishFollowUp(
    target: FollowUpTarget,
    markdown: string
): Promise<Exclude<FollowUpOutcome, "failed">> {
    const member = await resolveMemberContext(target.authUserId, target.companyId);
    if (!member) throw new FollowUpPermanentError(MEMBER_GONE);

    const written = await commitFollowUpNote(target, markdown);
    if (!written) return "stale";
    await indexFollowUpNote(target, written, () => member.documentScope());
    return "done";
}
