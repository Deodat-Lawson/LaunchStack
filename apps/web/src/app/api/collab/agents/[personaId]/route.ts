/**
 * Editing and retiring a single agent persona.
 *
 * DELETE archives rather than removing: persona ids appear in past transcripts
 * and in frozen meeting rosters, and those must keep resolving.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { getActiveCompanyId } from "~/lib/active-workspace";
import { archivePersona, updatePersona } from "~/server/collab/personas";

export const dynamic = "force-dynamic";

const UpdatePersonaSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9][a-z0-9_-]*$/)
    .optional(),
  displayName: z.string().min(1).max(80).optional(),
  role: z.string().min(1).max(80).optional(),
  systemPrompt: z.string().min(1).max(6000).optional(),
  nodeId: z.string().max(120).nullable().optional(),
  route: z.enum(["default", "fast", "reasoning", "vision"]).nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTurnChars: z.number().int().min(120).max(8000).nullable().optional(),
  accent: z.string().max(32).nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ personaId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = UpdatePersonaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const companyId = await getActiveCompanyId(userId);
  const { personaId } = await params;
  const persona = await updatePersona(companyId, personaId, parsed.data);
  if (!persona) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json({ persona });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ personaId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyId = await getActiveCompanyId(userId);
  const { personaId } = await params;
  const persona = await archivePersona(companyId, personaId);
  if (!persona) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json({ persona, archived: true });
}
