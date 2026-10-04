/**
 * Workspace onboarding: what a person tells us about the company when the
 * workspace is created. It lands in two places:
 *
 *   - the company record (description, industry) — the source sorter reads
 *     it as "already known" when it decides which documents are about you;
 *   - the company profile, as the person's own facts (manual edits: never
 *     overwritten by a build, editable and removable on the profile page).
 *
 * The website is a fact here; its page is imported as a source by the client
 * (`/api/upload/website`), so the profile can also quote it.
 */
import { eq } from "drizzle-orm";

import {
    applyFactEdit,
    createEmptyMetadata,
    diffMetadata,
    getProfileRow,
    saveProfileLocked,
    type FactEdit,
} from "@launchstack/pipelines/company-metadata";
import { company } from "@launchstack/store/schema";
import { readFact } from "@launchstack/tools/company-context/facts";

import { normalizeWebsite } from "~/lib/company-profile/website";
import { db } from "~/server/db";

export interface OnboardingAnswers {
    website?: string;
    description?: string;
    idea?: string;
    industry?: string;
}

export interface OnboardingState {
    name: string | null;
    website: string | null;
    description: string | null;
    idea: string | null;
    industry: string | null;
}

/** The profile fact that holds the idea; a custom key with its own label. */
export const IDEA_PATH = "profile.facts.idea";
export const IDEA_LABEL = "The idea";

/** The edits the answers make to the profile; blank answers change nothing. */
export function onboardingEdits(answers: OnboardingAnswers): FactEdit[] {
    const edits: FactEdit[] = [];
    const website = normalizeWebsite(answers.website);
    if (website) edits.push({ path: "company.website", value: website });
    const description = answers.description?.trim();
    if (description) edits.push({ path: "company.description", value: description });
    const idea = answers.idea?.trim();
    if (idea) edits.push({ path: IDEA_PATH, value: idea, label: IDEA_LABEL });
    return edits;
}

export async function saveOnboarding(
    ctx: { companyId: bigint; authUserId: string },
    answers: OnboardingAnswers
): Promise<{ website: string | null; facts: number }> {
    const description = answers.description?.trim();
    const industry = answers.industry?.trim();
    if (description || industry) {
        await db
            .update(company)
            .set({
                ...(description ? { description } : {}),
                ...(industry ? { industry } : {}),
            })
            .where(eq(company.id, Number(ctx.companyId)));
    }

    const edits = onboardingEdits(answers);
    if (edits.length > 0) {
        await saveProfileLocked(
            ctx.companyId,
            current => {
                const metadata = structuredClone(
                    current ?? createEmptyMetadata(String(ctx.companyId))
                );
                for (const edit of edits) applyFactEdit(metadata, edit);
                metadata.updated_at = new Date().toISOString();
                return { metadata, diff: diffMetadata(current, metadata) };
            },
            { changedBy: ctx.authUserId, changeType: "manual_override", built: false }
        );
    }
    return { website: normalizeWebsite(answers.website), facts: edits.length };
}

/** What onboarding already knows, so going through it again starts filled in. */
export async function loadOnboarding(ctx: { companyId: bigint }): Promise<OnboardingState> {
    const [[row], profile] = await Promise.all([
        db
            .select({
                name: company.name,
                description: company.description,
                industry: company.industry,
            })
            .from(company)
            .where(eq(company.id, Number(ctx.companyId))),
        getProfileRow(ctx.companyId),
    ]);
    const metadata = profile?.metadata ?? null;
    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
    return {
        name: row?.name ?? null,
        website: text(readFact(metadata?.company.website)),
        description: text(readFact(metadata?.company.description)) ?? row?.description ?? null,
        idea: text(readFact(metadata?.profile?.facts?.idea)),
        industry: row?.industry ?? null,
    };
}
