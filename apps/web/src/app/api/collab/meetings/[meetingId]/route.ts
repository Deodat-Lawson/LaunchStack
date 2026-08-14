/**
 * One meeting: its configuration, live state, transcript, and minutes.
 *
 * `?afterSeq=` returns only the tail, which is what the channel view polls on
 * so an open meeting streams without refetching the whole transcript.
 */

import { NextResponse } from "next/server";

import { buildMinutes } from "@launchstack/core/collab";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { getMeetingRuntime } from "~/server/collab/runtime";
import { getChannelStore } from "~/server/collab/store";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  const { meetingId } = await params;
  const runtime = await getMeetingRuntime(meetingId, ctx.data.companyId);
  if (!runtime) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const afterSeq = Number(searchParams.get("afterSeq") ?? "0");

  const store = getChannelStore();
  const [tail, channel] = await Promise.all([
    store.read(runtime.config.channelId, { afterSeq: Number.isFinite(afterSeq) ? afterSeq : 0 }),
    store.getChannel(runtime.config.channelId),
  ]);

  // Minutes need the whole conversation, not the requested tail.
  const full = afterSeq > 0 ? await store.read(runtime.config.channelId) : tail;

  return NextResponse.json({
    meeting: {
      id: runtime.config.id,
      title: runtime.config.title,
      objective: runtime.config.objective,
      agenda: runtime.config.agenda,
      participants: runtime.config.participants,
      turnPolicy: runtime.config.turnPolicy,
      maxTurns: runtime.config.maxTurns,
      channelId: runtime.config.channelId,
      channelSlug: channel?.slug ?? null,
      slack: runtime.config.slack ?? null,
      createdAt: runtime.row.createdAt.toISOString(),
    },
    state: runtime.orchestrator.getState(),
    messages: tail,
    latestSeq: full.length > 0 ? full[full.length - 1]!.seq : 0,
    minutes: buildMinutes(runtime.config, runtime.orchestrator.getState(), full),
  });
}
