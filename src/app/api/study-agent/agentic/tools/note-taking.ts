/**
 * Note-Taking Tool
 * Role: LangChain tool for creating/updating notes tied to a study session.
 * Purpose: persist quick notes with tags so the agent can reference later.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { NoteInput, StudyNote } from "../types";
import { db } from "~/server/db";
import { studyAgentNotes } from "~/server/db/schema";
import { resolveSessionForUser } from "~/server/study-agent/session";
import { and, eq } from "drizzle-orm";

// NOTE: "delete" stays in the schema for backward compatibility with callers,
// but the handler intentionally rejects it (see switch below).
const NoteSchema = z.object({
  action: z
    .enum(["create", "update", "delete", "list", "get"])
    .describe("The action to perform on notes"),
  userId: z.string().describe("The user ID"),
  noteId: z.string().optional().describe("Note ID for update/get actions"),
  data: z
    .object({
      title: z.string().optional(),
      content: z.string().optional(),
      // format: z.enum(["text", "markdown", "bullet_points"]).optional(), // TODO: support markdown formatting
      tags: z.array(z.string()).optional(),
    })
    .optional()
    .describe("Note data for create/update actions"),
  filters: z
    .object({
      tags: z.array(z.string()).optional(),
    })
    .optional()
    .describe("Optional filters for list action (e.g. filter by tags)"),
  sessionId: z.number().describe("Session ID to associate the note"),
});

/**
 * Manage study notes
 * Supports:
 * - create
 * - update
 * - list  (returns all notes for the session, with optional tag filter)
 * - get   (returns a single note by ID)
 * - delete (schema-compatible stub; intentionally rejected)
 */
export async function manageNotes(
  input: NoteInput & { userId: string; sessionId: number }
): Promise<{
  success: boolean;
  note?: StudyNote;
  notes?: StudyNote[];
  message: string;
}> {
  const now = new Date();

  const session = await resolveSessionForUser(input.userId, input.sessionId);
  if (!session) {
    return {
      success: false,
      message: "Unable to find a study session for this user. Please provide a valid sessionId.",
    };
  }

  const mapRowToNote = (row: (typeof studyAgentNotes)["$inferSelect"]) => ({
    id: row.id,
    userId: row.userId,
    title: row.title ?? "",
    content: row.content ?? "",
    tags: row.tags ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? row.createdAt,
  });

  switch (input.action) {
    case "create": {
      if (!input.data?.title && !input.data?.content) {
        return {
          success: false,
          message: "Note title or content is required",
        };
      }

      const [inserted] = await db
        .insert(studyAgentNotes)
        .values({
          userId: input.userId,
          sessionId: BigInt(session.id),
          title: input.data?.title ?? "Untitled Note",
          content: input.data?.content ?? "",
          tags: input.data?.tags ?? [],
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!inserted) {
        return { success: false, message: "Failed to create note" };
      }

      const newNote = mapRowToNote(inserted);
      console.log(`📝 [Notes] Created note: ${newNote.title}`);

      return {
        success: true,
        note: newNote,
        message: `Created note "${newNote.title}"${
          newNote.tags.length > 0 ? ` with tags: ${newNote.tags.join(", ")}` : ""
        }`,
      };
    }

    case "update": {
      if (!input.noteId) {
        return { success: false, message: "Note ID is required for update" };
      }

      const noteId = Number.parseInt(input.noteId, 10);
      if (Number.isNaN(noteId)) {
        return { success: false, message: "Note not found" };
      }

      const [existingNote] = await db
        .select()
        .from(studyAgentNotes)
        .where(
          and(
            eq(studyAgentNotes.id, noteId),
            eq(studyAgentNotes.userId, input.userId),
            eq(studyAgentNotes.sessionId, BigInt(session.id))
          )
        );

      if (!existingNote) {
        return { success: false, message: "Note not found" };
      }

      const [updated] = await db
        .update(studyAgentNotes)
        .set({
          title: input.data?.title ?? existingNote.title,
          content: input.data?.content ?? existingNote.content,
          tags: input.data?.tags ?? existingNote.tags,
          updatedAt: now,
        })
        .where(
          and(
            eq(studyAgentNotes.id, noteId),
            eq(studyAgentNotes.userId, input.userId),
            eq(studyAgentNotes.sessionId, BigInt(session.id))
          )
        )
        .returning();

      if (!updated) {
        return { success: false, message: "Unable to save note" };
      }

      const updatedNote = mapRowToNote(updated);
      console.log(`📝 [Notes] Updated note: ${updatedNote.title}`);

      return {
        success: true,
        note: updatedNote,
        message: `Updated note "${updatedNote.title}"`,
      };
    }

    case "list": {
      const rows = await db
        .select()
        .from(studyAgentNotes)
        .where(
          and(
            eq(studyAgentNotes.userId, input.userId),
            eq(studyAgentNotes.sessionId, BigInt(session.id))
          )
        );

      let notes = rows.map(mapRowToNote);

      // Apply optional tag filter when provided.
      const filterTags = (input as NoteInput & { filters?: { tags?: string[] } }).filters?.tags;
      if (filterTags && filterTags.length > 0) {
        notes = notes.filter((n) =>
          filterTags.some((tag) => n.tags.includes(tag))
        );
      }

      console.log(`📝 [Notes] Listed ${notes.length} note(s) for session ${session.id}`);

      return {
        success: true,
        notes,
        message: notes.length > 0
          ? `Found ${notes.length} note(s).`
          : "No notes found for this session.",
      };
    }

    case "get": {
      if (!input.noteId) {
        return { success: false, message: "Note ID is required for get" };
      }

      const noteId = Number.parseInt(input.noteId, 10);
      if (Number.isNaN(noteId)) {
        return { success: false, message: "Invalid note ID" };
      }

      const [row] = await db
        .select()
        .from(studyAgentNotes)
        .where(
          and(
            eq(studyAgentNotes.id, noteId),
            eq(studyAgentNotes.userId, input.userId),
            eq(studyAgentNotes.sessionId, BigInt(session.id))
          )
        );

      if (!row) {
        return { success: false, message: "Note not found" };
      }

      const note = mapRowToNote(row);
      console.log(`📝 [Notes] Retrieved note: ${note.title}`);

      return {
        success: true,
        note,
        message: `Retrieved note "${note.title}"`,
      };
    }

    // We intentionally do NOT support delete anymore.
    // Schema still includes it, so we return a clear error.
    case "delete":
      return {
        success: false,
        message: 'Action "delete" is not supported. Use "create", "update", "list", or "get".',
      };

    default:
      return { success: false, message: "Unknown action" };
  }
}

/**
 * Note-Taking Tool for LangChain
 * Only forwards create/update relevant fields.
 */
export const noteTakingTool = tool(
  async (input): Promise<string> => {
    try {
      const result = await manageNotes({
        action: input.action,
        userId: input.userId,
        noteId: input.noteId,
        data: input.data,
        filters: input.filters,
        sessionId: input.sessionId,
      });

      return JSON.stringify(result);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
  {
    name: "take_notes",
    description: `Create and manage study notes.
      Supported actions:
      - create: Create a new note (requires data.title or data.content)
      - update: Update an existing note (requires noteId)
      - list:   List all notes for the current session (optional: filters.tags to narrow results)
      - get:    Retrieve a single note by ID (requires noteId)

      Examples:
        "Take a note about photosynthesis"
        "Update my chemistry note with this new reaction"
        "Show me all my notes"
        "Get note 42"
        "List notes tagged 'biology'"`,
    schema: NoteSchema,
  }
);
