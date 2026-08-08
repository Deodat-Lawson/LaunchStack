import { and, eq } from "drizzle-orm";

import { getDb } from "@launchstack/core/db";
import {
  emailCampaigns,
  emailSends,
  emailSuppressions,
} from "@launchstack/core/db/schema";

import type { EmailTemplate, SendResult } from "./types";

/** Persistence + safety lookups for the email pipeline. */

/** Add an address to a company's suppression list (unsubscribe/bounce/manual). */
export async function addSuppression(
  companyId: number,
  email: string,
  reason: "unsubscribe" | "bounce" | "manual" = "unsubscribe",
): Promise<void> {
  const db = getDb();
  await db
    .insert(emailSuppressions)
    .values({
      companyId: BigInt(companyId),
      email: email.toLowerCase(),
      reason,
    })
    .onConflictDoNothing();
}

export async function isSuppressed(
  companyId: number,
  email: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ email: emailSuppressions.email })
    .from(emailSuppressions)
    .where(
      and(
        eq(emailSuppressions.companyId, BigInt(companyId)),
        eq(emailSuppressions.email, email.toLowerCase()),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function createCampaign(args: {
  companyId: number;
  name: string;
  template: EmailTemplate;
  model: string;
  promptVersion: string;
  templateVersion: string;
}): Promise<number> {
  const db = getDb();
  const [row] = await db
    .insert(emailCampaigns)
    .values({
      companyId: BigInt(args.companyId),
      name: args.name,
      status: "draft",
      subject: args.template.subject,
      body: args.template.body,
      model: args.model,
      promptVersion: args.promptVersion,
      templateVersion: args.templateVersion,
    })
    .returning({ id: emailCampaigns.id });
  if (!row) throw new Error("Failed to create email campaign");
  return row.id;
}

export async function saveSends(
  campaignId: number,
  results: SendResult[],
): Promise<void> {
  if (results.length === 0) return;
  const db = getDb();
  await db.insert(emailSends).values(
    results.map((r) => ({
      campaignId,
      recipientEmail: r.recipientEmail,
      status: r.status,
      providerMessageId: r.providerMessageId ?? null,
      error: r.error ?? null,
      sentAt: r.status === "sent" ? new Date() : null,
    })),
  );
}

/** Emails already delivered for a campaign — feeds send idempotency. */
export async function sentEmails(campaignId: number): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({
      email: emailSends.recipientEmail,
      status: emailSends.status,
    })
    .from(emailSends)
    .where(eq(emailSends.campaignId, campaignId));
  return new Set(rows.filter((r) => r.status === "sent").map((r) => r.email));
}
