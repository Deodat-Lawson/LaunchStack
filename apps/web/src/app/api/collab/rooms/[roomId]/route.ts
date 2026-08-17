/**
 * One room: its members, the log, and every round derived from it.
 *
 * `?afterSeq=` returns only the tail, which is what the client polls while a
 * round is in flight — answers land in the log the moment each member finishes,
 * so progressive rendering falls out of the existing poll with no streaming
 * transport involved.
 */

import { NextResponse } from "next/server";

import { summarizeRounds } from "@launchstack/core/collab";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { getRoom, type RoomMember } from "~/server/collab/rooms";
import { getChannelStore } from "~/server/collab/store";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  const { roomId } = await params;
  const row = await getRoom(roomId, ctx.data.companyId);
  if (!row) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const requested = Number(searchParams.get("afterSeq") ?? "0");
  const afterSeq = Number.isFinite(requested) && requested > 0 ? requested : 0;

  const store = getChannelStore();
  const [tail, channel] = await Promise.all([
    store.read(row.channelId, { afterSeq }),
    store.getChannel(row.channelId),
  ]);

  // Rounds need the whole log, not the requested tail — a round's question can
  // sit far behind the answer that just arrived.
  const full = afterSeq > 0 ? await store.read(row.channelId) : tail;

  return NextResponse.json({
    room: {
      id: row.id,
      name: row.name,
      purpose: row.purpose,
      channelId: row.channelId,
      channelSlug: channel?.slug ?? null,
      members: (row.members as RoomMember[]).map((m) => ({
        id: m.id,
        displayName: m.displayName,
        role: m.role,
        accent: m.accent ?? null,
        documentCount: m.documentIds?.length ?? 0,
      })),
      createdAt: row.createdAt.toISOString(),
    },
    messages: tail,
    latestSeq: full.length > 0 ? full[full.length - 1]!.seq : 0,
    rounds: summarizeRounds(full),
  });
}
