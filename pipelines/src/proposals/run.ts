/**
 * Runs: one background job over the grants tables. The route creates the
 * run row and hands it to an executor (the web process after the response,
 * or the worker); `executeProposalRun` does the reading and writing around the
 * stages and records each step so the run sheet can show progress.
 */
import type { DocumentScope } from "@launchstack/retrieval";

import {
    claimRun,
    completeRun,
    createRun,
    failRun,
    getApplication,
    getRun,
    isRunActive,
    listLibraryItems,
    listSections,
    noteLibraryUses,
    loadOrgProfile,
    loadReadableDocumentIds,
    replaceSections,
    updateApplication,
    updateRunSteps,
    updateSection,
    upsertOpportunity,
} from "./db";
import { sectionSourceProvenance } from "./evidence";
import { PROPOSAL_CREDITS, type ProposalDebitExecutor, type ProposalPorts } from "./ports";
import { requirementsFromExtracted } from "./requirements";
import { computeReadiness, syncSectionRequirements } from "./review";
import {
    draftSection,
    extractRequest,
    findFunders,
    reviewApplication,
    rewriteSection,
    MAX_REQUEST_CHARS,
} from "./stages";
import { wordCount } from "./text";
import type {
    LibraryItemRecord,
    RunInput,
    RunKind,
    RunRecord,
    RunStep,
    RunSummary,
    SectionRecord,
} from "./types";

export interface ProposalRunContext {
    runId: string;
    companyId: bigint;
    userId: string;
    scope: DocumentScope;
}

/** The steps a run of each kind will show before it starts. */
export function stepsFor(kind: RunKind, input: RunInput, sectionLabels: string[] = []): RunStep[] {
    const step = (id: string, label: string): RunStep => ({
        id,
        label,
        status: "waiting",
        detail: null,
    });
    switch (kind) {
        case "funders":
            return [
                step(
                    "plan",
                    input.funders?.keywords?.length ? "Using your keywords" : "Planning the search"
                ),
                step("search", "Searching Grants.gov and the web"),
                step("score", "Scoring fit"),
                step("save", "Saving funders"),
            ];
        case "extract":
            return [
                step("read", "Reading the request"),
                step("extract", "Extracting requirements"),
                step("checklist", "Building the checklist"),
            ];
        case "draft":
            return sectionLabels.length
                ? sectionLabels.map((label, i) => step(`draft:${i}`, label))
                : [step("draft", "Drafting sections")];
        case "rewrite":
            return [
                step("rewrite", sectionLabels[0] ? `Rewriting: ${sectionLabels[0]}` : "Rewriting"),
            ];
        case "review":
            return [
                step("check", "Checking the checklist"),
                step("review", "Reviewing the drafts"),
            ];
    }
}

/** Start a run row. The caller then hands its id to an executor. */
export async function queueProposalRun(args: {
    companyId: bigint;
    userId: string;
    kind: RunKind;
    input: RunInput;
    sectionLabels?: string[];
}): Promise<RunRecord> {
    return createRun({
        companyId: args.companyId,
        userId: args.userId,
        kind: args.kind,
        applicationId: args.input.applicationId ?? null,
        input: args.input,
        steps: stepsFor(args.kind, args.input, args.sectionLabels),
    });
}

class StepLog {
    constructor(
        private readonly ctx: ProposalRunContext,
        private steps: RunStep[]
    ) {}

    private async flush(): Promise<void> {
        if (!(await updateRunSteps(this.ctx.companyId, this.ctx.runId, this.steps))) {
            throw new Error("The run is no longer active");
        }
    }

    async start(id: string, detail: string | null = null): Promise<void> {
        this.steps = this.steps.map(s =>
            s.id === id
                ? { ...s, status: "running", detail, startedAt: new Date().toISOString() }
                : s
        );
        await this.flush();
    }

    async done(id: string, detail: string | null = null): Promise<void> {
        this.steps = this.steps.map(s =>
            s.id === id
                ? {
                      ...s,
                      status: "done",
                      detail: detail ?? s.detail,
                      completedAt: new Date().toISOString(),
                  }
                : s
        );
        await this.flush();
    }

    failedSteps(detail: string): RunStep[] {
        return this.steps.map(s =>
            s.status === "running"
                ? { ...s, status: "failed", detail, completedAt: new Date().toISOString() }
                : s.status === "waiting"
                  ? { ...s, status: "skipped" }
                  : s
        );
    }

    async assertActive(): Promise<void> {
        if (!(await isRunActive(this.ctx.companyId, this.ctx.runId))) {
            throw new Error("The run is no longer active");
        }
    }
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error) return error;
    return "The run failed";
}

async function debit(
    ports: ProposalPorts,
    ctx: ProposalRunContext,
    amount: number,
    description: string,
    executor: ProposalDebitExecutor
) {
    if (!ports.debitCredits) return 0;
    await ports.debitCredits({ amount, description, referenceId: ctx.runId }, executor);
    return amount;
}

/**
 * Execute only the delivery that atomically claims a queued run. A running
 * run is never reclaimed: redelivery observes its current state or expiry.
 */
export async function executeProposalRun(
    ctx: ProposalRunContext,
    ports: ProposalPorts
): Promise<RunRecord> {
    const run = await claimRun(ctx.companyId, ctx.runId);
    if (!run) {
        const existing = await getRun(ctx.runId, ctx.companyId);
        if (!existing) throw new Error("Run not found");
        return existing;
    }

    const log = new StepLog(ctx, run.steps);
    try {
        let summary: RunSummary;
        let amount: number;
        let description: string;
        switch (run.kind) {
            case "funders":
                summary = await runFunders(ctx, ports, log, run);
                amount = PROPOSAL_CREDITS.funders;
                description = "Proposals: funder search";
                break;
            case "extract":
                summary = await runExtract(ctx, ports, log, run);
                amount = PROPOSAL_CREDITS.extract;
                description = "Proposals: requirements";
                break;
            case "draft": {
                const result = await runDraft(ctx, ports, log, run);
                summary = result.summary;
                amount = PROPOSAL_CREDITS.draft * result.drafted;
                description = `Proposals: ${result.drafted} section draft${result.drafted === 1 ? "" : "s"}`;
                break;
            }
            case "rewrite":
                summary = await runRewrite(ctx, ports, log, run);
                amount = PROPOSAL_CREDITS.rewrite;
                description = "Proposals: rewrite";
                break;
            case "review":
                summary = await runReview(ctx, ports, log, run);
                amount = PROPOSAL_CREDITS.review;
                description = "Proposals: review";
                break;
        }
        summary.durationMs = Date.now() - run.startedAt!.getTime();
        const finished = await completeRun(ctx.companyId, ctx.runId, summary, executor =>
            debit(ports, ctx, amount, description, executor)
        );
        if (!finished) throw new Error("Run not found");
        return finished;
    } catch (error) {
        const message = errorMessage(error);
        const failed = await failRun(ctx.companyId, ctx.runId, message, log.failedSteps(message));
        if (!failed) throw new Error("Run not found");
        return failed;
    }
}

/** Mark a run failed from outside the executor without overwriting a terminal result. */
export async function failProposalRun(
    ctx: Pick<ProposalRunContext, "runId" | "companyId">,
    message: string
): Promise<void> {
    await failRun(ctx.companyId, ctx.runId, message);
}

// ─── Per kind ────────────────────────────────────────────────────────────────

async function runFunders(
    ctx: ProposalRunContext,
    ports: ProposalPorts,
    log: StepLog,
    run: RunRecord
): Promise<RunSummary> {
    const profile = await loadOrgProfile(ctx.companyId, ctx.scope);
    await log.start("plan");
    const details: Record<string, string> = {};
    const result = await findFunders(ports, {
        profile,
        overrides: run.input.funders,
        onStep: (step, detail) => {
            details[step] = detail;
        },
    });
    await log.done("plan", details.plan ?? null);
    await log.start("search");
    await log.done(
        "search",
        result.sources
            .map(
                s =>
                    `${s.id === "grants_gov" ? "Grants.gov" : "Web"}: ${s.status === "ok" ? s.found : s.status}`
            )
            .join(" · ")
    );
    await log.start("score");
    await log.done("score", details.score ?? "not scored");
    await log.start("save");
    let saved = 0;
    for (const { opportunity, fit } of result.scored) {
        await log.assertActive();
        await upsertOpportunity({
            companyId: ctx.companyId,
            source: opportunity.source,
            externalId: opportunity.externalId,
            title: opportunity.title,
            funder: opportunity.funder,
            url: opportunity.url,
            summary: opportunity.summary,
            opensOn: opportunity.opensOn,
            closesOn: opportunity.closesOn,
            amountMin: opportunity.amountMin,
            amountMax: opportunity.amountMax,
            eligibility: opportunity.eligibility,
            categories: opportunity.categories,
            fit,
            runId: ctx.runId,
            createdByUserId: ctx.userId,
        });
        saved++;
    }
    await log.done("save", `${saved} funders`);
    const strong = result.scored.filter(s => (s.fit?.score ?? 0) >= 70).length;
    return {
        headline: `${saved} funders found, ${strong} strong fits`,
        counts: { found: saved, strong },
    };
}

async function loadApplication(ctx: ProposalRunContext, run: RunRecord) {
    const applicationId = run.input.applicationId ?? run.applicationId;
    if (!applicationId) throw new Error("This run names no application");
    const application = await getApplication(applicationId, ctx.companyId);
    if (!application) throw new Error("Application not found");
    if (application.requestDocumentId !== null) {
        const readable = await loadReadableDocumentIds(ctx.companyId, ctx.scope, [
            application.requestDocumentId,
        ]);
        if (!readable.has(application.requestDocumentId))
            throw new Error("The application's request source is no longer readable.");
    }
    return application;
}

async function runExtract(
    ctx: ProposalRunContext,
    ports: ProposalPorts,
    log: StepLog,
    run: RunRecord
): Promise<RunSummary> {
    const application = await loadApplication(ctx, run);
    await log.start("read");
    let text = application.requestText ?? "";
    let label: string | null = null;
    if (!text.trim() && application.requestUrl) {
        if (!ports.fetchPage)
            throw new Error("This deployment cannot fetch pages; paste the request instead.");
        const page = await ports.fetchPage(application.requestUrl);
        text = page.text;
        label = page.title ? `${page.title} (${application.requestUrl})` : application.requestUrl;
        await log.assertActive();
        await updateApplication(ctx.companyId, application.id, {
            requestText: text.slice(0, MAX_REQUEST_CHARS),
        });
    }
    if (!text.trim())
        throw new Error("There is no request text to read. Paste the call or give its URL.");
    await log.done("read", `${text.length.toLocaleString()} characters`);

    await log.start("extract");
    const { extracted } = await extractRequest(ports, { text, sourceLabel: label });
    await log.done("extract", `${extracted.sections.length} sections`);

    await log.start("checklist");
    const sections = await replaceSections(ctx.companyId, application.id, extracted.sections);
    const requirements = syncSectionRequirements(
        requirementsFromExtracted(extracted, application.requirements),
        sections
    );
    await updateApplication(ctx.companyId, application.id, {
        extracted,
        requirements,
        title:
            application.title.startsWith("Untitled") && extracted.title
                ? extracted.title
                : undefined,
        funder: application.funder ?? extracted.funder ?? undefined,
        deadline: application.deadline ?? extracted.deadline ?? undefined,
        readiness: computeReadiness({ sections, requirements }),
    });
    await log.done("checklist", `${requirements.length} items`);
    return {
        headline: `${extracted.sections.length} sections, ${requirements.length} checklist items`,
        counts: { sections: extracted.sections.length, requirements: requirements.length },
    };
}

/** A saved answer's wording can carry any of the evidence it was written from. */
async function loadReadableLibrary(ctx: ProposalRunContext): Promise<LibraryItemRecord[]> {
    // An old evidence array cannot prove that a saved answer was manually
    // authored or that its now-mutable/deleted origin was the only input.
    const items = (await listLibraryItems(ctx.companyId)).filter(
        item => item.provenance.kind !== "unknown"
    );
    const readable = await loadReadableDocumentIds(
        ctx.companyId,
        ctx.scope,
        items.flatMap(item => [
            ...item.evidence.flatMap(e => (e.documentId === null ? [] : [e.documentId])),
            ...(item.provenance.kind === "sources" ? item.provenance.sourceDocumentIds : []),
        ])
    );
    return items.filter(
        item =>
            item.evidence.every(e => e.documentId !== null && readable.has(e.documentId)) &&
            (item.provenance.kind !== "sources" ||
                item.provenance.sourceDocumentIds.every(id => readable.has(id)))
    );
}

async function runDraft(
    ctx: ProposalRunContext,
    ports: ProposalPorts,
    log: StepLog,
    run: RunRecord
): Promise<{ summary: RunSummary; drafted: number }> {
    const application = await loadApplication(ctx, run);
    const [profile, library, all] = await Promise.all([
        loadOrgProfile(ctx.companyId, ctx.scope),
        loadReadableLibrary(ctx),
        listSections(ctx.companyId, application.id),
    ]);
    const wanted = run.input.sectionIds?.length ? new Set(run.input.sectionIds) : null;
    const targets = all.filter(s => (wanted ? wanted.has(s.id) : s.status === "empty"));
    if (targets.length === 0) return { summary: { headline: "Nothing to draft" }, drafted: 0 };
    let drafted = 0;
    for (const [i, section] of targets.entries()) {
        const stepId = run.steps.length === targets.length ? `draft:${i}` : "draft";
        await log.start(stepId, section.question.slice(0, 80));
        const result = await draftSection(ports, {
            companyId: Number(ctx.companyId),
            scope: ctx.scope,
            application,
            section,
            profile,
            library,
        });
        await log.assertActive();
        await updateSection(ctx.companyId, section.id, {
            draft: result.draft,
            draftMeta: result.meta,
            status: "drafted",
        });
        await noteLibraryUses(ctx.companyId, result.meta.libraryItemIds);
        drafted++;
        await log.done(
            stepId,
            `${result.meta.cites.length} citation${result.meta.cites.length === 1 ? "" : "s"}${result.meta.gaps.length ? ` · ${result.meta.gaps.length} gap${result.meta.gaps.length === 1 ? "" : "s"}` : ""}`
        );
    }
    const sections = await listSections(ctx.companyId, application.id);
    const requirements = syncSectionRequirements(application.requirements, sections);
    await log.assertActive();
    await updateApplication(ctx.companyId, application.id, {
        requirements,
        readiness: computeReadiness({ sections, requirements }),
        status: application.status === "draft" ? "in_progress" : undefined,
    });
    return {
        summary: {
            headline: `${drafted} section${drafted === 1 ? "" : "s"} drafted`,
            counts: { drafted },
        },
        drafted,
    };
}

/**
 * Existing prose may itself quote old evidence or a saved answer. Refuse reuse
 * instead of merely removing citations while still sending that prose.
 */
async function assertReadableDraftEvidence(
    ctx: ProposalRunContext,
    sections: SectionRecord[]
): Promise<void> {
    const evidence = sections.flatMap(section => section.draftMeta?.evidence ?? []);
    const sourceIds: number[] = [];
    const legacyLibraryIds: string[] = [];
    for (const section of sections) {
        const provenance = sectionSourceProvenance(section);
        if (provenance.kind === "unknown") {
            if (ctx.scope.kind !== "everything")
                throw new Error(
                    "This draft has unknown source evidence provenance. Redraft from readable sources first."
                );
            legacyLibraryIds.push(...(section.draftMeta?.libraryItemIds ?? []));
        } else if (provenance.kind === "sources") sourceIds.push(...provenance.sourceDocumentIds);
    }
    for (const item of evidence) if (item.documentId !== null) sourceIds.push(item.documentId);
    const readable = await loadReadableDocumentIds(ctx.companyId, ctx.scope, sourceIds);
    const library = legacyLibraryIds.length > 0 ? await loadReadableLibrary(ctx) : [];
    const readableLibraryIds = new Set(library.map(item => item.id));
    if (
        evidence.some(e => e.documentId === null || !readable.has(e.documentId)) ||
        sourceIds.some(id => !readable.has(id)) ||
        legacyLibraryIds.some(id => !readableLibraryIds.has(id))
    )
        throw new Error(
            "This draft uses evidence you can no longer read. Redraft from readable sources first."
        );
}

async function runRewrite(
    ctx: ProposalRunContext,
    ports: ProposalPorts,
    log: StepLog,
    run: RunRecord
): Promise<RunSummary> {
    const application = await loadApplication(ctx, run);
    const sectionId = run.input.sectionIds?.[0];
    if (!sectionId) throw new Error("This run names no section");
    const [profile, all] = await Promise.all([
        loadOrgProfile(ctx.companyId, ctx.scope),
        listSections(ctx.companyId, application.id),
    ]);
    const section = all.find(s => s.id === sectionId);
    if (!section) throw new Error("Section not found");
    await log.start("rewrite", section.question.slice(0, 80));
    await assertReadableDraftEvidence(ctx, [section]);
    const result = await rewriteSection(ports, {
        application,
        section,
        profile,
        preset: run.input.rewrite?.preset ?? "custom",
        instruction: run.input.rewrite?.instruction,
    });
    await log.assertActive();
    await updateSection(ctx.companyId, section.id, {
        draft: result.draft,
        draftMeta: result.meta,
        // A rewrite is machine text again; approval is a person's call to make afresh.
        status: "drafted",
    });
    const sections = await listSections(ctx.companyId, application.id);
    const requirements = syncSectionRequirements(application.requirements, sections);
    await log.assertActive();
    await updateApplication(ctx.companyId, application.id, {
        requirements,
        readiness: computeReadiness({ sections, requirements }),
    });
    const before = wordCount(section.draft);
    const after = wordCount(result.draft);
    await log.done("rewrite", `${before} → ${after} words`);
    return {
        headline: `Rewritten: ${before} → ${after} words`,
        counts: { before, after },
    };
}

async function runReview(
    ctx: ProposalRunContext,
    ports: ProposalPorts,
    log: StepLog,
    run: RunRecord
): Promise<RunSummary> {
    const application = await loadApplication(ctx, run);
    const [profile, sections] = await Promise.all([
        loadOrgProfile(ctx.companyId, ctx.scope),
        listSections(ctx.companyId, application.id),
    ]);
    await log.start("check");
    const requirements = syncSectionRequirements(application.requirements, sections);
    await log.done(
        "check",
        `${requirements.filter(r => r.done).length} of ${requirements.length} done`
    );
    await log.start("review");
    await assertReadableDraftEvidence(
        ctx,
        sections.filter(section => section.draft?.trim())
    );
    const review = await reviewApplication(ports, {
        application: { ...application, requirements },
        sections,
        profile,
    });
    await log.assertActive();
    await updateApplication(ctx.companyId, application.id, {
        requirements,
        review,
        readiness: review.readiness,
        status:
            application.status === "draft" || application.status === "in_progress"
                ? "in_review"
                : undefined,
    });
    const blockers = review.findings.filter(f => f.severity === "blocker").length;
    await log.done("review", `${review.findings.length} findings`);
    return {
        headline: `Readiness ${review.readiness}/100 · ${review.findings.length} findings${blockers ? ` · ${blockers} blocker${blockers === 1 ? "" : "s"}` : ""}`,
        counts: { findings: review.findings.length, blockers, readiness: review.readiness },
    };
}
