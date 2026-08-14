import { NextResponse } from "next/server";

import {
  addSuppression,
  verifyUnsubscribeToken,
} from "@launchstack/features/email-pipeline";

export const runtime = "nodejs";

/**
 * GET/POST /api/email-pipeline/unsubscribe/{token}
 *
 * The target of the unsubscribe link injected into every outreach email.
 * Public (no auth) — it is clicked from an email client — but not open: the
 * token is an HMAC over (companyId, email) that we issued, so the endpoint
 * only ever suppresses the address written inside a link we signed. The
 * previous `{companyId}/{email}` form let anyone suppress anyone by editing
 * the URL.
 *
 * GET renders a confirmation and changes nothing. That matters because mail
 * scanners and link-preview bots prefetch every URL in a message; a GET that
 * suppressed on sight would unsubscribe recipients who never clicked. The
 * suppression happens on POST, which is also what RFC 8058 one-click clients
 * send (see the `List-Unsubscribe-Post` header on outgoing mail).
 */

function page(title: string, detail: string, status: number) {
  return new NextResponse(`${title}\n\n${detail}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const claims = safeVerify((await params).token);
  if (!claims) {
    return page(
      "This unsubscribe link is not valid.",
      "It may have been altered or truncated by your mail client. Reply to the message and we'll remove you by hand.",
      400,
    );
  }

  return page(
    `Unsubscribe ${claims.email}?`,
    "Confirm by submitting a POST request to this same URL. Most mail clients " +
      "do this for you when you use their built-in unsubscribe button.",
    200,
  );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const claims = safeVerify((await params).token);
  if (!claims) {
    return page(
      "This unsubscribe link is not valid.",
      "It may have been altered or truncated by your mail client. Reply to the message and we'll remove you by hand.",
      400,
    );
  }

  try {
    await addSuppression(claims.companyId, claims.email, "unsubscribe");
    return page(
      "You've been unsubscribed.",
      `${claims.email} will no longer receive these emails.`,
      200,
    );
  } catch (error) {
    console.error("[email-pipeline/unsubscribe] failed:", error);
    return page(
      "Could not process your unsubscribe.",
      "Please try again later.",
      500,
    );
  }
}

/**
 * Verification never throws for attacker-controlled input. Two very different
 * failures land here, logged at different levels: a malformed token (bad `%`
 * escape, junk input — routine internet noise, `warn` so an attacker cannot
 * spam the error log) versus a missing/short signing secret (server
 * misconfiguration — `error`, it means every real link is broken too).
 */
function safeVerify(token: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(token);
  } catch {
    console.warn("[email-pipeline/unsubscribe] malformed token encoding");
    return null;
  }
  try {
    return verifyUnsubscribeToken(decoded);
  } catch (error) {
    console.error("[email-pipeline/unsubscribe] cannot verify token:", error);
    return null;
  }
}
