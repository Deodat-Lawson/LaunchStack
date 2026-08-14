import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { CampaignLifecycleError } from "@launchstack/features/email-pipeline";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

/**
 * Shared plumbing for the campaign lifecycle routes: who is calling, which
 * workspace they are acting in, and how lifecycle violations become responses.
 *
 * Every route resolves the company here and passes it into the feature layer,
 * which refuses to load a campaign that belongs to anyone else — a campaign id
 * in a URL is untrusted input.
 */

export interface CampaignActor {
  /** `users.id` — the internal row id, not the Clerk id. */
  userId: number;
  email: string | null;
  companyId: number;
  /** Sender identity injected into every email for CAN-SPAM compliance. */
  senderIdentity: string;
}

type ActorResult =
  | { ok: true; actor: CampaignActor }
  | { ok: false; response: NextResponse };

export async function resolveActor(): Promise<ActorResult> {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) {
    return { ok: false, response: ctx.response };
  }

  const [requestingUser] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, Number(ctx.data.userPk)))
    .limit(1);
  if (!requestingUser) {
    return { ok: false, response: fail("User not found", 404) };
  }

  return {
    ok: true,
    actor: {
      userId: Number(ctx.data.userPk),
      email: requestingUser.email ?? null,
      companyId: Number(ctx.data.companyId),
      senderIdentity:
        requestingUser.email ?? requestingUser.name ?? "the sender",
    },
  };
}

/** Parse a `[campaignId]` path segment. */
export function parseCampaignId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/**
 * Base for unsubscribe links. The company and address travel inside the signed
 * token the feature layer appends, never as guessable path segments.
 */
export function unsubscribeBaseUrl(request: Request) {
  return `${new URL(request.url).origin}/api/email-pipeline/unsubscribe`;
}

export function fail(message: string, status: number, extra?: object) {
  return NextResponse.json({ success: false, message, ...extra }, { status });
}

export function ok(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

/**
 * Lifecycle violations (not approved, review not passed, send already running)
 * carry their own status — they are expected outcomes, not server errors.
 */
export function handleRouteError(tag: string, error: unknown) {
  if (error instanceof CampaignLifecycleError) {
    return fail(error.message, error.status, { code: error.code });
  }
  console.error(`[${tag}] failed:`, error);
  return fail("Request failed", 500, {
    error: error instanceof Error ? error.message : "Unknown error",
  });
}
