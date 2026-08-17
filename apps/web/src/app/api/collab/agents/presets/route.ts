/**
 * Preset agent teams: list the packs, or add one to this workspace.
 *
 * Applying is additive and never destructive — a handle already in use is
 * reported back, not overwritten, because that handle is referenced by every
 * past transcript and by the frozen roster on every meeting that used it.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { applyPersonas, listPersonas } from "~/server/collab/personas";
import { getPack, listPackSummaries } from "~/server/collab/presets";

export const dynamic = "force-dynamic";

const ApplyPackSchema = z.object({
  packId: z.string().min(1).max(64),
});

export async function GET() {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  // Which handles are already taken, so the picker can warn before applying
  // rather than reporting skips afterwards.
  const existing = await listPersonas(ctx.data.companyId, true);
  const taken = new Set(existing.map((p) => p.id));

  return NextResponse.json({
    packs: listPackSummaries().map((pack) => ({
      ...pack,
      conflicts: pack.personas.filter((p) => taken.has(p.key)).map((p) => p.key),
    })),
  });
}

export async function POST(request: Request) {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  const parsed = ApplyPackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const pack = getPack(parsed.data.packId);
  if (!pack) {
    return NextResponse.json({ error: `Unknown preset "${parsed.data.packId}"` }, { status: 404 });
  }

  const result = await applyPersonas(ctx.data.companyId, pack.personas);
  const personas = await listPersonas(ctx.data.companyId);

  return NextResponse.json(
    {
      pack: { id: pack.id, name: pack.name, suggested: pack.suggested },
      created: result.created,
      skipped: result.skipped,
      personas,
    },
    // 200 rather than 201 when nothing was created: applying a pack twice is a
    // no-op, and the caller should not be told it made something.
    { status: result.created.length > 0 ? 201 : 200 },
  );
}
