/**
 * Meeting control: start, advance, pause, take over, hand back, close.
 *
 * `run` is bounded rather than unbounded so a request cannot sit open for the
 * length of an entire meeting — the channel view issues successive `run` calls
 * and watches the state come back.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { getMeetingRuntime } from "~/server/collab/runtime";

export const dynamic = "force-dynamic";
/** Long enough for several model turns; short enough to stay inside a request. */
export const maxDuration = 300;

const ControlSchema = z.object({
  action: z.enum(["start", "step", "run", "pause", "resume", "takeover", "release", "complete"]),
  /** Turns `run` may take in this call. */
  limit: z.number().int().min(1).max(10).optional(),
  asPersonaId: z.string().optional(),
  reason: z.string().max(200).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  const parsed = ControlSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { meetingId } = await params;
  const runtime = await getMeetingRuntime(meetingId, ctx.data.companyId);
  if (!runtime) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  const { orchestrator } = runtime;
  // Display name is cosmetic for takeover; keep Clerk claims as a best-effort
  // label without using them for authorization.
  const { sessionClaims } = await auth();
  const displayName =
    (sessionClaims?.name as string | undefined) ??
    (sessionClaims?.email as string | undefined) ??
    "Facilitator";

  try {
    switch (parsed.data.action) {
      case "start":
        await orchestrator.start();
        break;
      case "step":
        await orchestrator.step();
        break;
      case "run":
        await orchestrator.run({ limit: parsed.data.limit ?? 3 });
        break;
      case "pause":
        await orchestrator.pause();
        break;
      case "resume":
        await orchestrator.resume();
        break;
      case "takeover":
        await orchestrator.takeOver({
          humanId: ctx.data.clerkUserId,
          displayName,
          asPersonaId: parsed.data.asPersonaId,
        });
        break;
      case "release":
        await orchestrator.release();
        break;
      case "complete":
        await orchestrator.complete(parsed.data.reason);
        break;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Control action failed" },
      { status: 400 },
    );
  }

  return NextResponse.json({ state: orchestrator.getState() });
}
