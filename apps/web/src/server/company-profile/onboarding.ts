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
    type MetadataFact,
} from "@launchstack/pipelines/company-metadata";
import { findDocumentByCreationKey } from "@launchstack/engine";
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
    /** The person's own answers so far — never a value the documents supplied. */
    website: string | null;
    description: string | null;
    idea: string | null;
    industry: string | null;
    /** Which answers are already the person's facts on the profile, as shown. */
    saved: { website: boolean; description: boolean; idea: boolean };
    /** What the documents say, where they say it — shown as a hint, never as an answer. */
    fromSources: { website: string | null; description: string | null };
    /** The website's homepage is already a source (the import's creation key). */
    websiteImported: boolean;
    /** settings.manage: may save answers. Others are shown the way out. */
    canEdit: boolean;
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

/**
 * What onboarding already knows, so going through it again starts filled in.
 * Only the person's own facts (and the company record, which only people
 * write) are offered: a fact the documents supplied stays theirs, so saving
 * the form unchanged cannot turn it into a manual fact the builder never
 * updates again.
 */
export async function loadOnboarding(ctx: {
    companyId: bigint;
    can: (permission: "settings.manage") => boolean;
}): Promise<OnboardingState> {
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
    const text = (fact: MetadataFact<unknown> | undefined): string | null => {
        const value = readFact(fact);
        return typeof value === "string" && value.trim() ? value : null;
    };
    const own = (fact: MetadataFact<unknown> | undefined) =>
        fact?.priority === "manual_override" ? text(fact) : null;
    const sourced = (fact: MetadataFact<unknown> | undefined) =>
        fact?.priority === "manual_override" ? null : text(fact);
    const website = own(metadata?.company.website);
    const description = own(metadata?.company.description);
    const sourcedDescription = sourced(metadata?.company.description);
    // The company record holds what a person typed at signup or in the picker; it is
    // offered only while the profile has no description — not over one the documents
    // supply (a person may have chosen "Use what the sources say").
    const recorded = !sourcedDescription && row?.description?.trim() ? row.description : null;
    const idea = own(metadata?.profile?.facts?.idea);
    const imported = website
        ? await findDocumentByCreationKey(ctx.companyId, `website:${website}`)
        : null;
    return {
        name: row?.name ?? null,
        website,
        description: description ?? recorded,
        idea,
        industry: row?.industry ?? null,
        saved: {
            website: website !== null,
            description: description !== null,
            idea: idea !== null,
        },
        fromSources: {
            website: sourced(metadata?.company.website),
            description: sourcedDescription,
        },
        websiteImported: imported !== null,
        canEdit: ctx.can("settings.manage"),
    };
}
