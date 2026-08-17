/**
 * Ask the room.
 *
 * The request is held until every member has settled. That is deliberate:
 * members run concurrently, so wall time is the slowest member rather than
 * their sum, and `askRoom` appends each answer the moment it lands — so the
 * client's existing `?afterSeq=` poll renders answers progressively while this
 * request is still open. Returning 202 and continuing in the background would
 * orphan the work, since this subsystem already assumes one long-lived process.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { askRoom } from "@launchstack/core/collab";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { buildRoomRuntimes, getRoom, rowToConfig, type RoomMember } from "~/server/collab/rooms";
import { getChannelStore } from "~/server/collab/store";

export const dynamic = "force-dynamic";
/** Long enough for the slowest member; a round is concurrent, not sequential. */
export const maxDuration = 300;

const AskSchema = z.object({
  text: z.string().min(1).max(8000),
  /** Ask a subset. Defaults to every member. */
  memberIds: z.array(z.string().min(1)).min(1).max(10).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  const parsed = AskSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { roomId } = await params;
  const row = await getRoom(roomId, ctx.data.companyId);
  if (!row) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const config = rowToConfig(row);
  const members = row.members as RoomMember[];

  if (parsed.data.memberIds) {
    const known = new Set(members.map((m) => m.id));
    const unknown = parsed.data.memberIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Not a member of this room: ${unknown.join(", ")}` },
        { status: 400 },
      );
    }
  }

  const { sessionClaims } = await auth();
  const displayName =
    (sessionClaims?.name as string | undefined) ??
    (sessionClaims?.email as string | undefined) ??
    "Teammate";

  try {
    const result = await askRoom({
      store: getChannelStore(),
      room: config,
      // Retrieval runs as the asker, never the room's creator — a room must not
      // become a way to read documents you could not read yourself.
      runtimes: buildRoomRuntimes({ members, actorUserId: ctx.data.clerkUserId }),
      question: {
        text: parsed.data.text,
        author: { kind: "human", id: ctx.data.clerkUserId, displayName },
      },
      memberIds: parsed.data.memberIds,
    });

    return NextResponse.json(
      {
        roundId: result.roundId,
        question: result.question,
        answers: result.answers.map((a) => ({
          memberId: a.memberId,
          status: a.status,
          message: a.message,
          latencyMs: a.latencyMs,
          error: a.error,
        })),
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not ask the room" },
      { status: 400 },
    );
  }
}
