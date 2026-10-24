import { and, eq, inArray } from "drizzle-orm";

import { findDocumentByCreationKey } from "@launchstack/orchestration";
import type { SectionRecord } from "@launchstack/pipelines/proposals/types";
import { category, document } from "@launchstack/store/schema";

import { normalizeRoleSlug } from "~/lib/authz/permissions";
import {
    isFolderOrDescendant,
    scopeAllowsCategory,
    scopeAllowsDocument,
    scopeFolderRules,
} from "~/lib/authz/scope-types";
import { resolveMemberContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { documentGrants, documentSettings, folderGrants, folderSettings } from "~/server/db/schema";

export const PROPOSALS_EXPORT_CATEGORY = "Proposals";

interface ExportAudienceInput {
    companyId: bigint;
    userId: string;
    creationKey: string;
    sections: readonly SectionRecord[];
}

interface Audience {
    /** Every non-guest reader, including people who join after this export. */
    workspaceVisible: boolean;
    /** Stable grant principals, not the current people in a group or role. */
    principals: ReadonlySet<string>;
}

function principalKey(grant: { principalType: string; principalId: string }): string | null {
    switch (grant.principalType) {
        case "user":
        case "group":
            return `${grant.principalType}:${grant.principalId}`;
        case "role":
            return `role:${normalizeRoleSlug(grant.principalId)}`;
        default:
            return null;
    }
}

function audienceIsSubset(destination: Audience, source: Audience): boolean {
    if (destination.workspaceVisible && !source.workspaceVisible) return false;
    for (const principal of destination.principals) {
        if (source.principals.has(principal)) continue;
        if (source.workspaceVisible) {
            // Guests are not included in workspace visibility. A user/group
            // grant can reach a guest now or later; current membership is not
            // proof that the grant is covered by the non-guest default.
            if (source.principals.has("role:guest")) continue;
            if (principal.startsWith("role:") && principal !== "role:guest") continue;
        }
        return false;
    }
    return true;
}

/**
 * Publication must not widen the cited Sources' effective audience. This is a
 * policy comparison, not a census of today's readers: equal user/group/role
 * grants remain equal as membership changes, but user→group and group→role
 * implications are deliberately not inferred. Later independent ACL changes
 * are not synchronized with an already-published copy.
 */
export async function canExportApplication(input: ExportAudienceInput): Promise<boolean> {
    const citedIds = new Set<number>();
    for (const section of input.sections) {
        if (!section.draft?.trim()) continue;
        for (const n of section.draftMeta?.cites ?? []) {
            // Match renderApplicationMarkdown: an unresolved citation is not
            // rendered; uncited evidence and unwritten sections are omitted.
            const evidence = section.draftMeta?.evidence.find(item => item.n === n);
            if (!evidence) continue;
            if (
                evidence.documentId === null ||
                !Number.isSafeInteger(evidence.documentId) ||
                evidence.documentId <= 0
            )
                return false;
            citedIds.add(evidence.documentId);
        }
    }

    const [member, existingDestination] = await Promise.all([
        resolveMemberContext(input.userId, input.companyId),
        findDocumentByCreationKey(input.companyId, input.creationKey),
    ]);
    if (!member) return false;
    const scope = await member.documentScope();
    if (
        existingDestination
            ? !scopeAllowsDocument(scope, existingDestination)
            : !scopeAllowsCategory(scope, PROPOSALS_EXPORT_CATEGORY)
    )
        return false;
    if (citedIds.size === 0) return true;

    const sourceIds = [...citedIds];
    const documentIds = sourceIds.map(BigInt);
    if (existingDestination && !citedIds.has(existingDestination.id))
        documentIds.push(BigInt(existingDestination.id));
    const [sources, restrictedFolders, grantsOnFolders, restrictedDocuments, grantsOnDocuments] =
        await Promise.all([
            db
                .select({ id: document.id, category: document.category })
                .from(document)
                .where(
                    and(eq(document.companyId, input.companyId), inArray(document.id, sourceIds))
                ),
            db
                .select({ id: folderSettings.categoryId, name: category.name })
                .from(folderSettings)
                .innerJoin(category, eq(category.id, folderSettings.categoryId))
                .where(
                    and(
                        eq(folderSettings.companyId, input.companyId),
                        eq(category.companyId, input.companyId),
                        eq(folderSettings.visibility, "restricted")
                    )
                ),
            db
                .select({
                    categoryId: folderGrants.categoryId,
                    name: category.name,
                    principalType: folderGrants.principalType,
                    principalId: folderGrants.principalId,
                })
                .from(folderGrants)
                .innerJoin(category, eq(category.id, folderGrants.categoryId))
                .where(
                    and(
                        eq(folderGrants.companyId, input.companyId),
                        eq(category.companyId, input.companyId)
                    )
                ),
            db
                .select({ id: documentSettings.documentId })
                .from(documentSettings)
                .where(
                    and(
                        eq(documentSettings.companyId, input.companyId),
                        eq(documentSettings.restricted, true),
                        inArray(documentSettings.documentId, documentIds)
                    )
                ),
            db
                .select({
                    documentId: documentGrants.documentId,
                    principalType: documentGrants.principalType,
                    principalId: documentGrants.principalId,
                })
                .from(documentGrants)
                .where(
                    and(
                        eq(documentGrants.companyId, input.companyId),
                        inArray(documentGrants.documentId, documentIds)
                    )
                ),
        ]);
    // Tenant-scoped lookup deliberately makes missing and foreign Sources the
    // same denial. A readable title/quote in saved metadata is not provenance.
    if (
        sources.length !== citedIds.size ||
        sources.some(source => !scopeAllowsDocument(scope, source))
    )
        return false;

    const restrictedDocumentIds = new Set(restrictedDocuments.map(row => Number(row.id)));
    const folderRules = scopeFolderRules({
        kind: "except",
        deniedCategories: restrictedFolders.map(folder => folder.name),
        deniedDocumentIds: [],
        allowedDocumentIds: [],
    });
    const audienceFor = (path: string, documentId?: number): Audience | null => {
        const principals = new Set<string>();
        if (documentId !== undefined) {
            for (const grant of grantsOnDocuments) {
                if (Number(grant.documentId) !== documentId) continue;
                const key = principalKey(grant);
                if (key) principals.add(key);
            }
            // Explicit document restrictions replace, rather than inherit,
            // folder visibility. Reach-in grants on inheriting files add to it.
            if (restrictedDocumentIds.has(documentId))
                return { workspaceVisible: false, principals };
        }

        // Use the scope evaluator's ordering: the nearest restricted ancestor
        // wins. Ancestor grants cannot cross a deeper restriction; grants on
        // inheriting descendants can reach into the restricted subtree.
        const nearest = folderRules.find(rule => isFolderOrDescendant(path, rule.path));
        if (nearest && restrictedFolders.filter(folder => folder.name === nearest.path).length > 1)
            return null;
        for (const grant of grantsOnFolders) {
            if (!isFolderOrDescendant(path, grant.name)) continue;
            if (nearest && !isFolderOrDescendant(grant.name, nearest.path)) continue;
            // Duplicate folder names with different restrictions cannot be
            // proven equivalent to a single grant policy; fail closed.
            if (
                nearest &&
                grant.name === nearest.path &&
                !restrictedFolders.some(folder => folder.id === grant.categoryId)
            )
                return null;
            const key = principalKey(grant);
            if (key) principals.add(key);
        }
        return { workspaceVisible: !nearest, principals };
    };

    const destination = audienceFor(
        existingDestination?.category ?? PROPOSALS_EXPORT_CATEGORY,
        existingDestination?.id
    );
    if (!destination) return false;
    return sources.every(source => {
        const audience = audienceFor(source.category, source.id);
        return audience !== null && audienceIsSubset(destination, audience);
    });
}
