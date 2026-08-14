/**
 * The workspace's agent roster.
 *
 * GET seeds the starter personas on first read so the Agents pane is never
 * an empty state that the user has to escape from.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { createPersona, ensureStarterPersonas } from "~/server/collab/personas";
import { getHub, listKnownNodes } from "~/server/collab/runtime";
import { getSlackStatus } from "~/server/collab/slack";

export const dynamic = "force-dynamic";

/** Persona handles are used as `@key` in transcripts, so keep them mention-safe. */
const PersonaKey = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "Use lowercase letters, digits, - and _");

const CreatePersonaSchema = z.object({
  key: PersonaKey,
  displayName: z.string().min(1).max(80),
  role: z.string().min(1).max(80),
  systemPrompt: z.string().min(1).max(6000),
  nodeId: z.string().max(120).nullable().optional(),
  route: z.enum(["default", "fast", "reasoning", "vision"]).nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTurnChars: z.number().int().min(120).max(8000).nullable().optional(),
  accent: z.string().max(32).nullable().optional(),
});

export async function GET() {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  const { companyId } = ctx.data;
  const personas = await ensureStarterPersonas(companyId);
  const hub = getHub();
  // Node bookkeeping must never take the roster down with it — a persona whose
  // node is unreachable is exactly when this page needs to render.
  const nodes = await listKnownNodes(companyId).catch((err: unknown) => {
    console.error("[collab] could not list worker nodes:", err);
    return hub?.listNodes() ?? [];
  });

  return NextResponse.json({
    personas,
    nodes,
    network: {
      enabled: Boolean(hub),
      hubId: hub?.hubId ?? null,
      /** Where a remote worker points `COLLAB_HUB_URL`. */
      hubPath: "/api/collab/hub",
    },
    slack: getSlackStatus(),
  });
}

export async function POST(request: Request) {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  const parsed = CreatePersonaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const persona = await createPersona(ctx.data.companyId, parsed.data);
    return NextResponse.json({ persona }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create agent";
    // The unique index on (company_id, key) is the real guard; report it as a
    // conflict rather than a 500 so the form can point at the field.
    const conflict = /duplicate key|unique/i.test(message);
    return NextResponse.json(
      { error: conflict ? `An agent with the handle "${parsed.data.key}" already exists` : message },
      { status: conflict ? 409 : 500 },
    );
  }
}
