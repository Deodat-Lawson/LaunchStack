/**
 * The follow-up note LaunchStack writes after each save: one note per saved
 * conversation, owned by the person who saved it, attached to the
 * conversation's document, refreshed in place on every re-save.
 *
 * Runs after the tool has answered (`./after-response`). Its state lives on
 * the `assistant_conversations` row: `pending` while queued, then `done`, or
 * `failed` with the error. A failure here never touches the saved
 * conversation — the document and its versions are already committed.
 *
 * Re-saves race: two saves of one conversation can each queue a follow-up,
 * and the slower model call must not overwrite the newer note. Each run
 * carries the content hash it was generated from, and writes only while the
 * row still has that hash — checked under a row lock, in the same transaction
 * as the note write.
 */
import { and, eq } from "drizzle-orm";

import type { DocumentScope } from "~/lib/authz/scope-types";
import { ASSISTANT_LABELS } from "~/lib/session-transcript";
import { db } from "~/server/db";
import { assistantConversations, documentNotes, type AssistantClient } from "~/server/db/schema";
import { afterNoteWrite, insertNoteRow, type DocumentNoteRow } from "~/server/notes/create-note";

import {
    generateFollowUpContent,
    type FollowUpContent,
    type FollowUpPromptInput,
} from "./follow-up-model";
import type { NormalizedMessage } from "./validate";

export const FOLLOW_UP_TAG = "assistant-follow-up";

export interface FollowUpJob {
    /** `assistant_conversations.id`. */
    conversationRowId: number;
    documentId: number;
    companyId: bigint;
    /** The saver: the note's owner. */
    authUserId: string;
    title: string;
    family: AssistantClient;
    /** The hash this run is generated from; the note is written only while the row still has it. */
    contentHash: string;
    messages: readonly NormalizedMessage[];
    /** The saver's document scope, for the note's wiki-link sync. */
    documentScope: () => Promise<DocumentScope>;
}

export type FollowUpOutcome = "done" | "failed" | "stale";

type Generate = (input: FollowUpPromptInput) => Promise<FollowUpContent>;

const MAX_ITEMS = 25;
const MAX_ITEM_CHARS = 600;
const MAX_SUMMARY_CHARS = 4_000;
const MAX_ERROR_CHARS = 1_000;

/** One list item: one line, no bullet or checkbox of its own. */
function cleanItem(item: string): string {
    return item
        .replace(/\s+/g, " ")
        .replace(/^(?:[-*+•]\s+|\d+[.)]\s+)/, "")
        .replace(/^\[[ xX]\]\s+/, "")
        .trim()
        .slice(0, MAX_ITEM_CHARS);
}

function cleanList(items: readonly string[]): string[] {
    return items
        .map(cleanItem)
        .filter(item => item.length > 0)
        .slice(0, MAX_ITEMS);
}

/** Paragraphs kept; a line the note editor would read as a heading is not one. */
function cleanSummary(summary: string): string {
    return summary
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map(line => line.replace(/^\s*#{1,6}\s+/, "").trimEnd())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, MAX_SUMMARY_CHARS);
}

/**
 * The note body, in the small Markdown grammar the note editor round-trips
 * (`##` headings, `-` bullets). Summary, Decisions and Action items always
 * appear — an empty one says so — and Open questions only when there are any.
 */
export function renderFollowUpNote(content: FollowUpContent, family: AssistantClient): string {
    const decisions = cleanList(content.decisions);
    const actions = cleanList(content.actionItems);
    const questions = cleanList(content.openQuestions);
    const bullets = (items: string[], empty: string) =>
        items.length > 0 ? items.map(item => `- ${item}`).join("\n") : empty;

    const sections = [
        `*Written by LaunchStack from this conversation with ${ASSISTANT_LABELS[family]}. Saving the conversation again refreshes it.*`,
        `## Summary\n\n${cleanSummary(content.summary) || "The conversation had no content to summarise."}`,
        `## Decisions\n\n${bullets(decisions, "No decisions were made.")}`,
        `## Action items\n\n${bullets(actions, "No action items.")}`,
    ];
    if (questions.length > 0) sections.push(`## Open questions\n\n${bullets(questions, "")}`);
    return sections.join("\n\n");
}

export function followUpNoteTitle(title: string): string {
    return `Follow-up: ${title}`;
}

function errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return (message || "The follow-up note could not be written").slice(0, MAX_ERROR_CHARS);
}

/** Record a failure, unless a newer save has already moved the row on. Never throws. */
async function markFailed(job: FollowUpJob, error: unknown): Promise<void> {
    try {
        await db
            .update(assistantConversations)
            .set({ followUpStatus: "failed", followUpError: errorMessage(error) })
            .where(
                and(
                    eq(assistantConversations.id, job.conversationRowId),
                    eq(assistantConversations.contentHash, job.contentHash)
                )
            );
    } catch (writeError) {
        console.error(
            `[assistant-conversations] could not record follow-up failure for conversation ${job.documentId}:`,
            writeError
        );
    }
}

/**
 * Generate and write (or refresh) the follow-up note for one save.
 * Never throws: every failure ends as `failed` on the row.
 */
export async function writeFollowUp(
    job: FollowUpJob,
    generate: Generate = generateFollowUpContent
): Promise<FollowUpOutcome> {
    let markdown: string;
    try {
        const content = await generate({
            title: job.title,
            family: job.family,
            messages: job.messages,
        });
        markdown = renderFollowUpNote(content, job.family);
    } catch (error) {
        console.error(
            `[assistant-conversations] follow-up generation failed for conversation ${job.documentId}:`,
            error
        );
        await markFailed(job, error);
        return "failed";
    }

    let written: { note: DocumentNoteRow; reason: "created" | "updated" } | null;
    try {
        written = await db.transaction(async tx => {
            const [row] = await tx
                .select({
                    contentHash: assistantConversations.contentHash,
                    followUpNoteId: assistantConversations.followUpNoteId,
                })
                .from(assistantConversations)
                .where(eq(assistantConversations.id, job.conversationRowId))
                .for("update")
                .limit(1);
            // Gone, or re-saved since this run started: the newer run writes the note.
            if (!row || row.contentHash !== job.contentHash) return null;

            const fields = {
                title: followUpNoteTitle(job.title),
                contentMarkdown: markdown,
                // Server-written notes are markdown only; the editor parses it on open.
                contentRich: null,
                content: null,
                tags: [FOLLOW_UP_TAG, job.family],
            };

            let note: DocumentNoteRow | undefined;
            let reason: "created" | "updated" = "updated";
            if (row.followUpNoteId !== null) {
                [note] = await tx
                    .update(documentNotes)
                    .set(fields)
                    .where(
                        and(
                            eq(documentNotes.id, row.followUpNoteId),
                            eq(documentNotes.userId, job.authUserId)
                        )
                    )
                    .returning();
            }
            if (!note) {
                // First save, or the person deleted the earlier note: write a new one.
                note = await insertNoteRow(tx, {
                    authUserId: job.authUserId,
                    companyId: job.companyId,
                    documentId: String(job.documentId),
                    ...fields,
                });
                reason = "created";
            }
            if (!note) throw new Error("The follow-up note was not written");

            await tx
                .update(assistantConversations)
                .set({ followUpNoteId: note.id, followUpStatus: "done", followUpError: null })
                .where(eq(assistantConversations.id, job.conversationRowId));
            return { note, reason };
        });
    } catch (error) {
        console.error(
            `[assistant-conversations] follow-up note write failed for conversation ${job.documentId}:`,
            error
        );
        await markFailed(job, error);
        return "failed";
    }
    if (!written) return "stale";

    // Committed: the note is written and the row says so. Its embedding and
    // link sync log their own failures and never undo that.
    try {
        await afterNoteWrite(written.note, written.reason, {
            companyId: job.companyId,
            scope: await job.documentScope(),
        });
    } catch (error) {
        console.error(
            `[assistant-conversations] follow-up note ${written.note.id} saved, but indexing it failed:`,
            error
        );
    }
    return "done";
}
