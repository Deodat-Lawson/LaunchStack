/**
 * Proposals service: loads the vertical's records for a workspace and hands
 * them to the adapter. Routes stay thin; everything that touches the
 * database lives here. Tenancy is by the `companyId` on the context, never
 * a value from the request body.
 */
import { and, asc, count, desc, eq, ilike } from "drizzle-orm";

import { document, documentContextChunks } from "@launchstack/store/schema";
import {
    computeReadiness,
    makeApplicationCreationKey,
    blankToNull,
    makeApplicationFilename,
    renderApplicationMarkdown,
    slugKey,
    syncSectionRequirements,
    toggleRequirement,
    type ApplicationStatus,
    type OpportunityStatus,
    type RewritePreset,
    type SectionStatus,
} from "@launchstack/pipelines/proposals";
import {
    addSection,
    createApplication,
    createLibraryItem,
    createManualOpportunity,
    deleteApplication,
    deleteLibraryItem,
    deleteOpportunity,
    deleteSection,
    findLiveRun,
    getApplication,
    getLibraryItem,
    getOpportunity,
    getRun,
    getSection,
    listApplications,
    listLibraryItems,
    listOpportunities,
    listRuns,
    listSections,
    loadOrgProfile,
    setOpportunityStatus,
    updateApplication,
    updateLibraryItem,
    updateSection,
} from "@launchstack/pipelines/proposals/db";
import { getProfileRow, profileView } from "@launchstack/pipelines/company-metadata";

import type {
    ApplicationDetail,
    ApplicationPatch,
    ApplicationRow,
    CountsDto,
    FunderRow,
    HomeDto,
    LibraryItemDto,
    NewApplicationInput,
    NewFunderInput,
    RunDto,
    SectionDto,
    SectionPatch,
    SourceOption,
} from "~/app/employer/tools/proposals/api";
import { db } from "~/server/db";
import { isBuilding } from "~/server/company-profile/adapter";
import { uploadFile } from "~/lib/storage";
import { processDocumentUpload } from "~/server/services/document-upload";

import {
    OPEN_STATUSES,
    buildTodo,
    byDeadline,
    toApplicationDetail,
    toApplicationRow,
    toFunderRow,
    toLibraryItemDto,
    toRunDto,
    toSectionDto,
} from "./adapter";
import { startProposalRun } from "./executor";

export interface ProposalsCtx {
    companyId: bigint;
    /** Better Auth user id; owners are stored as this string. */
    userId: string;
}

export class ProposalsError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly extra: Record<string, unknown> = {}
    ) {
        super(message);
        this.name = "ProposalsError";
    }
}

const PROPOSALS_BASE = "/employer/tools/proposals";
const href = (path: string) => `${PROPOSALS_BASE}${path}`;

async function countSources(companyId: bigint): Promise<number> {
    const [row] = await db
        .select({ n: count() })
        .from(document)
        .where(eq(document.companyId, companyId));
    return Number(row?.n ?? 0);
}

/** The text of a Source, from its indexed chunks in order. Empty when it has none yet. */
export async function readSourceText(companyId: bigint, documentId: number): Promise<string> {
    const rows = await db
        .select({ content: documentContextChunks.content })
        .from(documentContextChunks)
        .innerJoin(document, eq(documentContextChunks.documentId, document.id))
        .where(and(eq(document.id, documentId), eq(document.companyId, companyId)))
        .orderBy(asc(documentContextChunks.id))
        .limit(400);
    return rows
        .map(r => r.content.trim())
        .filter(Boolean)
        .join("\n\n");
}

export async function listSourceOptions(
    ctx: ProposalsCtx,
    query?: string
): Promise<SourceOption[]> {
    const where = query?.trim()
        ? and(eq(document.companyId, ctx.companyId), ilike(document.title, `%${query.trim()}%`))
        : eq(document.companyId, ctx.companyId);
    const rows = await db
        .select({
            id: document.id,
            title: document.title,
            folder: document.category,
            updatedAt: document.updatedAt,
            createdAt: document.createdAt,
        })
        .from(document)
        .where(where)
        .orderBy(desc(document.createdAt))
        .limit(30);
    return rows.map(r => ({
        id: r.id,
        title: r.title,
        folder: r.folder,
        updatedAt: (r.updatedAt ?? r.createdAt).toISOString(),
    }));
}

// ─── Funders ─────────────────────────────────────────────────────────────────

async function applicationsByOpportunity(ctx: ProposalsCtx): Promise<Map<string, string>> {
    const apps = await listApplications(ctx.companyId);
    const map = new Map<string, string>();
    for (const app of apps)
        if (app.opportunityId && !map.has(app.opportunityId)) map.set(app.opportunityId, app.id);
    return map;
}

export async function loadFunders(
    ctx: ProposalsCtx,
    status?: OpportunityStatus
): Promise<FunderRow[]> {
    const now = new Date();
    const [records, byOpportunity] = await Promise.all([
        listOpportunities(ctx.companyId, { statuses: status ? [status] : undefined }),
        applicationsByOpportunity(ctx),
    ]);
    return records
        .map(r => toFunderRow(r, { now, applicationId: byOpportunity.get(r.id) ?? null }))
        .sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1) || b.foundAt.localeCompare(a.foundAt));
}

export async function findFundersRun(
    ctx: ProposalsCtx,
    input: {
        keywords?: string[];
        geography?: string;
        applicantType?: FunderRow["status"] extends never ? never : string;
        includeWeb?: boolean;
    }
): Promise<RunDto> {
    const profile = await loadOrgProfile(ctx.companyId);
    if (!profile && !(input.keywords && input.keywords.length > 0))
        throw new ProposalsError(
            "Build your organisation profile first, or give keywords to search for",
            409,
            {
                code: "profile_required",
            }
        );
    const run = await startProposalRun({
        companyId: ctx.companyId,
        userId: ctx.userId,
        kind: "funders",
        input: {
            funders: {
                keywords: input.keywords?.length ? input.keywords : undefined,
                geography: blankToNull(input.geography) ?? undefined,
                applicantType: input.applicantType as never,
                includeWeb: input.includeWeb,
            },
        },
    });
    return toRunDto(run);
}

export async function addFunder(ctx: ProposalsCtx, input: NewFunderInput): Promise<FunderRow> {
    const record = await createManualOpportunity({
        companyId: ctx.companyId,
        title: input.title,
        funder: input.funder,
        url: input.url ?? null,
        summary: input.summary ?? null,
        closesOn: input.closesOn ?? null,
        amountMin: input.amountMin ?? null,
        amountMax: input.amountMax ?? null,
        createdByUserId: ctx.userId,
    });
    return toFunderRow(record, { now: new Date() });
}

export async function setFunderStatus(
    ctx: ProposalsCtx,
    id: string,
    status: OpportunityStatus
): Promise<FunderRow> {
    const record = await setOpportunityStatus(ctx.companyId, id, status);
    if (!record) throw new ProposalsError("Funder not found", 404);
    const byOpportunity = await applicationsByOpportunity(ctx);
    return toFunderRow(record, { now: new Date(), applicationId: byOpportunity.get(id) ?? null });
}

export async function removeFunder(ctx: ProposalsCtx, id: string): Promise<void> {
    if (!(await deleteOpportunity(ctx.companyId, id)))
        throw new ProposalsError("Funder not found", 404);
}

// ─── Applications ────────────────────────────────────────────────────────────

async function sectionsByApplication(ctx: ProposalsCtx, ids: string[]) {
    const entries = await Promise.all(
        ids.map(async id => [id, await listSections(ctx.companyId, id)] as const)
    );
    return new Map(entries);
}

export async function loadApplications(ctx: ProposalsCtx): Promise<ApplicationRow[]> {
    const now = new Date();
    const records = await listApplications(ctx.companyId);
    const sections = await sectionsByApplication(
        ctx,
        records.map(r => r.id)
    );
    return records.map(r => toApplicationRow(r, sections.get(r.id) ?? [], now));
}

export async function loadApplication(ctx: ProposalsCtx, id: string): Promise<ApplicationDetail> {
    const record = await getApplication(id, ctx.companyId);
    if (!record) throw new ProposalsError("Application not found", 404);
    const sections = await listSections(ctx.companyId, id);
    return toApplicationDetail(record, sections, new Date());
}

export async function newApplication(
    ctx: ProposalsCtx,
    input: NewApplicationInput
): Promise<{ application: ApplicationDetail; run: RunDto | null }> {
    let funder = input.funder ?? null;
    let requestText = blankToNull(input.requestText);
    let title = input.title.trim();
    let deadline = input.deadline ?? null;
    let requestUrl = blankToNull(input.requestUrl);
    if (input.opportunityId) {
        const opportunity = await getOpportunity(input.opportunityId, ctx.companyId);
        if (!opportunity) throw new ProposalsError("Funder not found", 404);
        funder ??= opportunity.funder;
        title ||= opportunity.title;
        deadline ??= opportunity.closesOn;
        requestUrl ??= opportunity.url;
        if (!requestText && opportunity.summary) {
            requestText = [
                opportunity.title,
                opportunity.funder,
                opportunity.eligibility ? `Eligibility: ${opportunity.eligibility}` : "",
                opportunity.amountMax
                    ? `Award up to $${opportunity.amountMax.toLocaleString()}`
                    : "",
                opportunity.closesOn ? `Closes ${opportunity.closesOn}` : "",
                "",
                opportunity.summary,
            ]
                .filter(Boolean)
                .join("\n");
        }
        await setOpportunityStatus(ctx.companyId, opportunity.id, "applied");
    }
    if (input.requestDocumentId) {
        const text = await readSourceText(ctx.companyId, input.requestDocumentId);
        if (!text)
            throw new ProposalsError(
                "That source has no readable text yet; wait for it to finish processing",
                409
            );
        requestText = text;
    }
    const record = await createApplication({
        companyId: ctx.companyId,
        createdByUserId: ctx.userId,
        title: title || "Untitled application",
        funder,
        opportunityId: input.opportunityId ?? null,
        deadline,
        requestText,
        requestUrl,
        requestDocumentId: input.requestDocumentId ?? null,
    });
    let run: RunDto | null = null;
    if (requestText || requestUrl) {
        run = toRunDto(
            await startProposalRun({
                companyId: ctx.companyId,
                userId: ctx.userId,
                kind: "extract",
                input: { applicationId: record.id },
            })
        );
    }
    return { application: toApplicationDetail(record, [], new Date()), run };
}

const STATUS_ORDER: ApplicationStatus[] = [
    "draft",
    "in_progress",
    "in_review",
    "ready",
    "submitted",
    "awarded",
    "declined",
    "withdrawn",
];

export async function patchApplication(
    ctx: ProposalsCtx,
    id: string,
    input: ApplicationPatch
): Promise<ApplicationDetail> {
    const record = await getApplication(id, ctx.companyId);
    if (!record) throw new ProposalsError("Application not found", 404);
    const sections = await listSections(ctx.companyId, id);
    let requirements = record.requirements;
    if (input.requirement) {
        requirements = toggleRequirement(
            requirements,
            input.requirement.id,
            input.requirement.done
        );
    }
    requirements = syncSectionRequirements(requirements, sections);
    if (input.status && !STATUS_ORDER.includes(input.status))
        throw new ProposalsError("Unknown status", 400);
    const updated = await updateApplication(ctx.companyId, id, {
        title: blankToNull(input.title) ?? undefined,
        funder: input.funder,
        status: input.status,
        deadline: input.deadline,
        notes: input.notes,
        requestText: input.requestText,
        requestUrl: input.requestUrl,
        requirements,
        readiness: computeReadiness({ sections, requirements }),
        submittedAt: input.status === "submitted" && !record.submittedAt ? new Date() : undefined,
    });
    if (!updated) throw new ProposalsError("Application not found", 404);
    return toApplicationDetail(updated, sections, new Date());
}

export async function removeApplication(ctx: ProposalsCtx, id: string): Promise<void> {
    if (!(await deleteApplication(ctx.companyId, id)))
        throw new ProposalsError("Application not found", 404);
}

async function requireOpenApplication(ctx: ProposalsCtx, id: string) {
    const record = await getApplication(id, ctx.companyId);
    if (!record) throw new ProposalsError("Application not found", 404);
    return record;
}

export async function extractRun(ctx: ProposalsCtx, id: string): Promise<RunDto> {
    const record = await requireOpenApplication(ctx, id);
    if (!record.requestText?.trim() && !record.requestUrl)
        throw new ProposalsError("Paste the funder's request or give its URL first", 409, {
            code: "request_required",
        });
    return toRunDto(
        await startProposalRun({
            companyId: ctx.companyId,
            userId: ctx.userId,
            kind: "extract",
            input: { applicationId: id },
        })
    );
}

export async function draftRun(
    ctx: ProposalsCtx,
    id: string,
    sectionIds?: string[]
): Promise<RunDto> {
    await requireOpenApplication(ctx, id);
    const sections = await listSections(ctx.companyId, id);
    const wanted = sectionIds?.length ? new Set(sectionIds) : null;
    const targets = sections.filter(s => (wanted ? wanted.has(s.id) : s.status === "empty"));
    if (targets.length === 0)
        throw new ProposalsError(
            wanted
                ? "Section not found"
                : "Every section already has a draft; redraft one from its own menu",
            409,
            { code: "nothing_to_draft" }
        );
    return toRunDto(
        await startProposalRun({
            companyId: ctx.companyId,
            userId: ctx.userId,
            kind: "draft",
            input: { applicationId: id, sectionIds: targets.map(t => t.id) },
            sectionLabels: targets.map(t => t.question.slice(0, 80)),
        })
    );
}

export async function rewriteRun(
    ctx: ProposalsCtx,
    applicationId: string,
    sectionId: string,
    input: { preset: RewritePreset; instruction?: string }
): Promise<RunDto> {
    await requireOpenApplication(ctx, applicationId);
    const section = await getSection(ctx.companyId, sectionId);
    if (!section || section.applicationId !== applicationId)
        throw new ProposalsError("Section not found", 404);
    if (!section.draft?.trim())
        throw new ProposalsError("Write or draft the answer first, then rewrite it", 409, {
            code: "nothing_to_rewrite",
        });
    return toRunDto(
        await startProposalRun({
            companyId: ctx.companyId,
            userId: ctx.userId,
            kind: "rewrite",
            input: {
                applicationId,
                sectionIds: [sectionId],
                rewrite: {
                    preset: input.preset,
                    instruction: blankToNull(input.instruction) ?? undefined,
                },
            },
            sectionLabels: [section.question.slice(0, 60)],
        })
    );
}

/** The whole proposal as one markdown document, for reading and copying. */
export async function renderProposalMarkdown(
    ctx: ProposalsCtx,
    id: string
): Promise<{ markdown: string; filename: string }> {
    const record = await requireOpenApplication(ctx, id);
    const sections = await listSections(ctx.companyId, id);
    return {
        markdown: renderApplicationMarkdown({
            application: record,
            sections,
            exportedAt: new Date(),
        }),
        filename: makeApplicationFilename(record),
    };
}

export async function reviewRun(ctx: ProposalsCtx, id: string): Promise<RunDto> {
    await requireOpenApplication(ctx, id);
    return toRunDto(
        await startProposalRun({
            companyId: ctx.companyId,
            userId: ctx.userId,
            kind: "review",
            input: { applicationId: id },
        })
    );
}

/** Publish the application into Sources as markdown, so it becomes citable knowledge. */
export async function exportApplication(
    ctx: ProposalsCtx,
    id: string,
    requestUrl: string
): Promise<ApplicationDetail> {
    const record = await requireOpenApplication(ctx, id);
    const sections = await listSections(ctx.companyId, id);
    if (sections.every(s => !s.draft?.trim()))
        throw new ProposalsError("Nothing has been written yet", 409, { code: "nothing_written" });
    const exportedAt = new Date();
    const markdown = renderApplicationMarkdown({ application: record, sections, exportedAt });
    const filename = makeApplicationFilename(record);
    const stored = await uploadFile({
        filename,
        data: Buffer.from(markdown, "utf8"),
        contentType: "text/markdown",
        userId: ctx.userId,
        companyId: ctx.companyId,
    });
    const upload = await processDocumentUpload({
        user: { userId: ctx.userId, companyId: ctx.companyId },
        documentName: `${record.title} — proposal`,
        rawDocumentUrl: stored.url,
        creationKey: makeApplicationCreationKey(record.id, exportedAt),
        category: "Proposals",
        explicitStorageType: stored.provider,
        mimeType: "text/markdown",
        originalFilename: filename,
        requestUrl,
    });
    const updated = await updateApplication(ctx.companyId, id, {
        exportedDocumentId: upload.document.id,
    });
    return toApplicationDetail(updated ?? record, sections, new Date());
}

// ─── Sections ────────────────────────────────────────────────────────────────

async function refreshReadiness(ctx: ProposalsCtx, applicationId: string): Promise<void> {
    const record = await getApplication(applicationId, ctx.companyId);
    if (!record) return;
    const sections = await listSections(ctx.companyId, applicationId);
    const requirements = syncSectionRequirements(record.requirements, sections);
    await updateApplication(ctx.companyId, applicationId, {
        requirements,
        readiness: computeReadiness({ sections, requirements }),
        status:
            record.status === "draft" && sections.some(s => s.status !== "empty")
                ? "in_progress"
                : undefined,
    });
}

export async function newSection(
    ctx: ProposalsCtx,
    applicationId: string,
    input: { question: string; guidance?: string | null; wordLimit?: number | null }
): Promise<SectionDto> {
    await requireOpenApplication(ctx, applicationId);
    const existing = await listSections(ctx.companyId, applicationId);
    let key = slugKey(input.question);
    let n = 2;
    while (existing.some(s => s.key === key)) key = `${slugKey(input.question, 44)}-${n++}`;
    const section = await addSection(ctx.companyId, applicationId, {
        key,
        question: input.question.trim(),
        guidance: blankToNull(input.guidance),
        wordLimit: input.wordLimit ?? null,
        required: true,
    });
    const record = await getApplication(applicationId, ctx.companyId);
    if (record) {
        await updateApplication(ctx.companyId, applicationId, {
            requirements: [
                ...record.requirements,
                {
                    id: `section:${key}`,
                    kind: "section",
                    text: `Answer: ${section.question}${section.wordLimit ? ` (${section.wordLimit} words)` : ""}`,
                    done: false,
                    sectionKey: key,
                },
            ],
        });
    }
    await refreshReadiness(ctx, applicationId);
    return toSectionDto(section);
}

const SECTION_STATUSES: SectionStatus[] = ["empty", "drafted", "edited", "approved"];

export async function patchSection(
    ctx: ProposalsCtx,
    applicationId: string,
    sectionId: string,
    input: SectionPatch
): Promise<SectionDto> {
    const current = await getSection(ctx.companyId, sectionId);
    if (!current || current.applicationId !== applicationId)
        throw new ProposalsError("Section not found", 404);
    if (input.status && !SECTION_STATUSES.includes(input.status))
        throw new ProposalsError("Unknown status", 400);
    let status = input.status;
    if (input.draft !== undefined && status === undefined) {
        // Typing into a draft makes it "edited"; clearing it makes it empty.
        status = input.draft?.trim()
            ? current.status === "approved"
                ? "approved"
                : "edited"
            : "empty";
    }
    if (input.status === "approved" && !(input.draft ?? current.draft)?.trim())
        throw new ProposalsError("Write the answer before approving it", 409);
    const updated = await updateSection(ctx.companyId, sectionId, {
        draft: input.draft,
        status,
        question: blankToNull(input.question) ?? undefined,
        guidance: input.guidance,
        wordLimit: input.wordLimit,
        draftMeta: input.draft !== undefined && !input.draft?.trim() ? null : undefined,
    });
    if (!updated) throw new ProposalsError("Section not found", 404);
    await refreshReadiness(ctx, applicationId);
    return toSectionDto(updated);
}

export async function removeSection(
    ctx: ProposalsCtx,
    applicationId: string,
    sectionId: string
): Promise<void> {
    const current = await getSection(ctx.companyId, sectionId);
    if (!current || current.applicationId !== applicationId)
        throw new ProposalsError("Section not found", 404);
    await deleteSection(ctx.companyId, sectionId);
    const record = await getApplication(applicationId, ctx.companyId);
    if (record) {
        await updateApplication(ctx.companyId, applicationId, {
            requirements: record.requirements.filter(r => r.sectionKey !== current.key),
        });
    }
    await refreshReadiness(ctx, applicationId);
}

// ─── Library ─────────────────────────────────────────────────────────────────

async function applicationTitles(ctx: ProposalsCtx): Promise<Map<string, string>> {
    const apps = await listApplications(ctx.companyId);
    return new Map(apps.map(a => [a.id, a.title]));
}

export async function loadLibrary(ctx: ProposalsCtx): Promise<LibraryItemDto[]> {
    const [items, titles] = await Promise.all([
        listLibraryItems(ctx.companyId),
        applicationTitles(ctx),
    ]);
    return items.map(item => toLibraryItemDto(item, titles));
}

export async function saveSectionToLibrary(
    ctx: ProposalsCtx,
    applicationId: string,
    sectionId: string,
    tags: string[]
): Promise<LibraryItemDto> {
    const section = await getSection(ctx.companyId, sectionId);
    if (!section || section.applicationId !== applicationId)
        throw new ProposalsError("Section not found", 404);
    if (!section.draft?.trim()) throw new ProposalsError("Write the answer before saving it", 409);
    const cited = new Set(section.draftMeta?.cites ?? []);
    const item = await createLibraryItem({
        companyId: ctx.companyId,
        createdByUserId: ctx.userId,
        question: section.question,
        answer: section.draft.trim(),
        tags: tags
            .map(t => t.trim())
            .filter(Boolean)
            .slice(0, 10),
        evidence: (section.draftMeta?.evidence ?? []).filter(e => cited.has(e.n)),
        sourceApplicationId: applicationId,
        sourceSectionKey: section.key,
    });
    return toLibraryItemDto(item, await applicationTitles(ctx));
}

export async function newLibraryItem(
    ctx: ProposalsCtx,
    input: { question: string; answer: string; tags?: string[] }
): Promise<LibraryItemDto> {
    const item = await createLibraryItem({
        companyId: ctx.companyId,
        createdByUserId: ctx.userId,
        question: input.question.trim(),
        answer: input.answer.trim(),
        tags: (input.tags ?? [])
            .map(t => t.trim())
            .filter(Boolean)
            .slice(0, 10),
        evidence: [],
        sourceApplicationId: null,
        sourceSectionKey: null,
    });
    return toLibraryItemDto(item, new Map());
}

export async function editLibraryItem(
    ctx: ProposalsCtx,
    id: string,
    input: { question?: string; answer?: string; tags?: string[] }
): Promise<LibraryItemDto> {
    const item = await updateLibraryItem(ctx.companyId, id, {
        question: blankToNull(input.question) ?? undefined,
        answer: blankToNull(input.answer) ?? undefined,
        tags: input.tags
            ?.map(t => t.trim())
            .filter(Boolean)
            .slice(0, 10),
    });
    if (!item) throw new ProposalsError("Library item not found", 404);
    return toLibraryItemDto(item, await applicationTitles(ctx));
}

export async function removeLibraryItem(ctx: ProposalsCtx, id: string): Promise<void> {
    if (!(await getLibraryItem(ctx.companyId, id)))
        throw new ProposalsError("Library item not found", 404);
    await deleteLibraryItem(ctx.companyId, id);
}

// ─── Runs ────────────────────────────────────────────────────────────────────

export async function loadRuns(ctx: ProposalsCtx, applicationId?: string): Promise<RunDto[]> {
    const runs = await listRuns(ctx.companyId, { applicationId, limit: 50 });
    return runs.map(toRunDto);
}

export async function loadRun(ctx: ProposalsCtx, id: string): Promise<RunDto> {
    const run = await getRun(id, ctx.companyId);
    if (!run) throw new ProposalsError("Run not found", 404);
    return toRunDto(run);
}

// ─── Home and counts ─────────────────────────────────────────────────────────

/** The company profile as the Proposals home reads it: built, being built, or not yet. */
async function profileStatus(ctx: ProposalsCtx): Promise<HomeDto["profile"]> {
    const row = await getProfileRow(ctx.companyId);
    const view = profileView(row?.metadata ?? null);
    return {
        status: isBuilding(row, new Date()) ? "building" : row?.builtAt ? "ready" : "empty",
        builtAt: row?.builtAt?.toISOString() ?? null,
        facts: view.facts.length,
        documents: view.documents,
    };
}

export async function loadCounts(ctx: ProposalsCtx): Promise<CountsDto> {
    const [profile, funders, applications, library] = await Promise.all([
        profileStatus(ctx),
        listOpportunities(ctx.companyId, { statuses: ["saved", "applied"] }),
        listApplications(ctx.companyId),
        listLibraryItems(ctx.companyId),
    ]);
    return {
        profileReady: profile.status === "ready",
        funders: funders.length,
        applications: applications.filter(a => OPEN_STATUSES.has(a.status)).length,
        library: library.length,
    };
}

export async function loadHome(ctx: ProposalsCtx): Promise<HomeDto> {
    const [profile, sources, applications, funders, library, runs, live] = await Promise.all([
        profileStatus(ctx),
        countSources(ctx.companyId),
        loadApplications(ctx),
        loadFunders(ctx),
        listLibraryItems(ctx.companyId),
        listRuns(ctx.companyId, { limit: 1 }),
        findLiveRun(ctx.companyId),
    ]);
    const open = applications.filter(a => OPEN_STATUSES.has(a.status));
    const candidates = funders.filter(f => f.status === "candidate");
    const strong = candidates.filter(f => (f.fit ?? 0) >= 70);
    return {
        profile,
        todo: buildTodo({
            profileReady: profile.status === "ready",
            sources,
            applications,
            funders,
            href,
        }),
        deadlines: byDeadline(open.filter(a => a.deadline)).slice(0, 6),
        inProgress: open
            .filter(a => !a.deadline || (a.daysLeft ?? 0) > 7)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 6),
        funders: {
            saved: funders.filter(f => f.status === "saved").length,
            candidates: candidates.length,
            strong: strong.length,
            top: [...strong, ...candidates.filter(f => (f.fit ?? 0) < 70)].slice(0, 5),
        },
        library: library.length,
        lastRunAt: (live ?? runs[0])?.createdAt.toISOString() ?? null,
    };
}
