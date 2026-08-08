import { NextResponse } from "next/server";

import { addSuppression } from "@launchstack/features/email-pipeline";

export const runtime = "nodejs";

/**
 * GET /api/email-pipeline/unsubscribe/{companyId}/{email}
 * The target of the unsubscribe link injected into every outreach email.
 * Adds the address to the company's suppression list so it's honored on every
 * future campaign. Public (no auth) — it's clicked from an email client.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ companyId: string; email: string }> },
) {
  const { companyId, email } = await params;
  const cid = Number(companyId);
  const addr = decodeURIComponent(email);

  if (Number.isNaN(cid) || !addr.includes("@")) {
    return new NextResponse("Invalid unsubscribe link.", { status: 400 });
  }

  try {
    await addSuppression(cid, addr, "unsubscribe");
    return new NextResponse(
      `You've been unsubscribed. ${addr} will no longer receive these emails.`,
      { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  } catch (error) {
    console.error("[email-pipeline/unsubscribe] failed:", error);
    return new NextResponse(
      "Could not process your unsubscribe. Please try again later.",
      { status: 500 },
    );
  }
}
