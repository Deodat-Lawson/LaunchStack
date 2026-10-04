/**
 * The builder end to end over an in-memory workspace: a company deck, a
 * third-party research paper, and a test mindmap — the LaunchStack Dev case.
 * The model is scripted; the database is a map. What is checked is the
 * contract: other people's material never reaches extraction, edits survive
 * rebuilds, a person's override brings a source in, a deleted or rewritten
 * source takes its facts with it, and unchanged sources are not re-read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CompanyMetadataJSON, CompanyProfileSourceRow, MetadataDiff } from "./types";

// ─── In-memory workspace ─────────────────────────────────────────────────────

interface Doc {
    id: number;
    companyId: bigint;
    title: string;
    folder: string;
    currentVersionId: number | null;
    creationKey: string | null;
    ocrMetadata: unknown;
    mimeType: string | null;
}

const store = vi.hoisted(() => ({
    docs: new Map<number, unknown>(),
    chunks: new Map<string, unknown[]>(),
    rows: new Map<number, Record<string, unknown>>(),
    profile: null as null | { metadata: unknown; buildStatus: string; builtAt: Date | null },
    history: [] as unknown[],
}));

vi.mock("@launchstack/tools/company-context", () => ({ getCompanyIdentity: vi.fn() }));

vi.mock("./db", () => {
    const counted = (row: { override?: string | null; role?: string | null }) =>
        row.override ? row.override === "about_us" : row.role === "about_us";
    return {
        isCounted: counted,
        listWorkspaceDocuments: async () => [...store.docs.values()],
        getWorkspaceDocument: async (_c: bigint, id: number) => store.docs.get(id) ?? null,
        loadVersionChunks: async (id: number, version: number) =>
            store.chunks.get(`${id}:${version}`) ?? [],
        getSourceRow: async (_c: bigint, id: number) => store.rows.get(id) ?? null,
        upsertSourceRow: async (companyId: bigint, id: number, values: Record<string, unknown>) => {
            const row = {
                status: "pending",
                override: null,
                facts: null,
                factCount: 0,
                ...store.rows.get(id),
                ...values,
                companyId,
                documentId: BigInt(id),
            };
            store.rows.set(id, row);
            return row;
        },
        listCountedSources: async () =>
            [...store.rows.values()]
                .filter(
                    r =>
                        store.docs.has(Number(r.documentId)) &&
                        r.status === "done" &&
                        r.facts !== null &&
                        counted(r)
                )
                .map(r => ({ ...r, title: (store.docs.get(Number(r.documentId)) as Doc).title })),
        getProfileRow: async () => store.profile,
        listSourceRows: async () =>
            [...store.rows.values()].filter(r => store.docs.has(Number(r.documentId))),
        startBuild: async () => {
            const at = new Date();
            store.profile = {
                metadata: store.profile?.metadata ?? null,
                builtAt: store.profile?.builtAt ?? null,
                buildStatus: "building",
            };
            return at;
        },
        finishBuild: async (_c: bigint, _at: Date, status: string) => {
            if (store.profile) store.profile = { ...store.profile, buildStatus: status };
        },
        setBuildStatus: async (_c: bigint, status: string) => {
            store.profile = {
                metadata: store.profile?.metadata ?? null,
                builtAt: store.profile?.builtAt ?? null,
                buildStatus: status,
            };
        },
        saveProfileLocked: async (
            _c: bigint,
            finish: (
                current: unknown,
                tx: unknown
            ) => Promise<{ metadata: unknown; diff: MetadataDiff } | null>
        ) => {
            const result = await finish(store.profile?.metadata ?? null, "tx");
            if (!result) return null;
            store.profile = {
                buildStatus: store.profile?.buildStatus ?? "idle",
                metadata: result.metadata,
                builtAt: new Date(),
            };
            const d = result.diff;
            if (d.added.length + d.updated.length + d.deprecated.length) store.history.push(d);
            return result;
        },
    };
});

const { assembleProfile, readSource, rebuildProfile, recordOverride, refreshForDocument } =
    await import("./build");
const { applyFactEdit } = await import("./edit");
const { profileView } = await import("./views");

// ─── The workspace ───────────────────────────────────────────────────────────

const C = 50n;
const DECK =
    "Acme Robotics builds warehouse robots for mid-size grocers. Founded in 2019, we are headquartered in Baltimore, MD. Jane Doe is our CEO and co-founder; she previously ran logistics at a national grocery chain.";
const PAPER =
    "Dense X Retrieval: What Retrieval Granularity Should We Use? Tong Chen, University of Washington; Hongwei Wang, Tencent AI Lab. We provide a systemic study on how retrieval granularity impacts retrieval and downstream task performance across five open-domain question answering datasets.";

function doc(id: number, title: string, version: number, creationKey = "upload:x"): Doc {
    return {
        id,
        companyId: C,
        title,
        folder: "Unfiled",
        currentVersionId: version,
        creationKey,
        ocrMetadata: null,
        mimeType: "application/pdf",
    };
}

function chunk(id: number, text: string, title: string) {
    return { id, content: `${title}\n\n${text}`, page: 1, semanticType: "narrative" };
}

const say = (
    section: string,
    field: string,
    value: string,
    quote: string,
    subject: string | null = null
) => ({
    section,
    subject,
    field,
    value,
    quote,
    passage: 1,
    confidence: 0.95,
    visibility: "public",
    usage: "outreach_ok",
});

function factsFor(prompt: string) {
    const facts: unknown[] = [];
    if (prompt.includes("Acme Robotics builds")) {
        facts.push(
            say(
                "company",
                "name",
                "Acme Robotics",
                "Acme Robotics builds warehouse robots for mid-size grocers."
            ),
            say(
                "company",
                "headquarters",
                "Baltimore, MD",
                "we are headquartered in Baltimore, MD."
            ),
            say("people", "name", "Jane Doe", "Jane Doe is our CEO and co-founder", "Jane Doe"),
            say(
                "people",
                "role",
                "CEO and co-founder",
                "Jane Doe is our CEO and co-founder",
                "Jane Doe"
            )
        );
    }
    if (prompt.includes("serves grocers across Texas"))
        facts.push(
            say("markets", "geographies", "Texas", "Acme Robotics serves grocers across Texas.")
        );
    if (prompt.includes("Rewritten deck"))
        facts.push(
            say("company", "headquarters", "Austin, TX", "We moved our headquarters to Austin, TX.")
        );
    if (prompt.includes("Dense X Retrieval"))
        facts.push(
            say(
                "profile",
                "partners",
                "University of Washington",
                "Tong Chen, University of Washington"
            )
        );
    return { facts };
}

const calls: Array<{ schemaName: string; prompt: string }> = [];
/** Milliseconds the next summary call waits — to make one build finish after another. */
const slowSummaries: number[] = [];
const generate = vi.fn(async (input: { prompt: string; schemaName?: string }) => {
    calls.push({ schemaName: input.schemaName ?? "", prompt: input.prompt });
    if (input.schemaName === "company_profile_summary") {
        const wait = slowSummaries.shift();
        if (wait) await new Promise(r => setTimeout(r, wait));
    }
    if (input.schemaName === "source_role")
        return input.prompt.includes("Acme Robotics builds") ||
            input.prompt.includes("Rewritten deck") ||
            input.prompt.includes("serves grocers across Texas")
            ? {
                  role: "about_us",
                  reason: "Acme Robotics' own pitch deck.",
                  subject: "Acme Robotics",
              }
            : {
                  role: "third_party",
                  reason: "A research paper by authors at the University of Washington and Tencent AI Lab — not about Acme Robotics.",
                  subject: "retrieval granularity",
              };
    if (input.schemaName === "company_profile_facts") return factsFor(input.prompt);
    if (input.schemaName === "company_profile_summary")
        return {
            summary: "Acme Robotics builds warehouse robots.",
            summary_facts: [1],
            applicant_type: "for_profit",
            applicant_facts: [1],
            focus_areas: [{ value: "warehouse automation", facts: [1] }],
        };
    throw new Error(`unexpected call ${input.schemaName}`);
});

const ports = {
    generate: generate as never,
    modelId: "fake",
    identity: async () => ({ name: "Acme Robotics", known: [] }),
    now: () => new Date("2026-10-03T12:00:00Z"),
};

const metadata = () => store.profile?.metadata as CompanyMetadataJSON;
const row = (id: number) => store.rows.get(id) as unknown as CompanyProfileSourceRow;
const extractionPrompts = () =>
    calls.filter(c => c.schemaName === "company_profile_facts").map(c => c.prompt);

beforeEach(() => {
    store.docs.clear();
    store.chunks.clear();
    store.rows.clear();
    store.profile = null;
    store.history.length = 0;
    calls.length = 0;
    slowSummaries.length = 0;
    store.docs.set(1, doc(1, "Acme deck.pdf", 11));
    store.chunks.set("1:11", [chunk(101, DECK, "Acme deck.pdf")]);
    store.docs.set(2, doc(2, "2312.06648v3.pdf", 21));
    store.chunks.set("2:21", [chunk(201, PAPER, "2312.06648v3.pdf")]);
    store.docs.set(3, doc(3, "Untitled mindmap", 31, "mindmap:9"));
    store.chunks.set("3:31", [chunk(301, "- Hi\n  - Test Example", "Untitled mindmap › Hi")]);
});

describe("rebuildProfile", () => {
    it("reads only the company's own sources for facts and says why the others were set aside", async () => {
        const result = await rebuildProfile(C, ports, { changedBy: "u1" });
        expect(result).toMatchObject({ sources: 3, failed: 0 });

        expect(row(1)).toMatchObject({ role: "about_us", roleBy: "model", status: "done" });
        expect(row(2)).toMatchObject({
            role: "third_party",
            roleBy: "model",
            facts: null,
            factCount: 0,
        });
        expect(row(2).reason).toContain("research paper");
        expect(row(3)).toMatchObject({ role: "no_content", roleBy: "rules", facts: null });

        // The paper never reached extraction; the mindmap never reached the model at all.
        expect(extractionPrompts()).toHaveLength(1);
        expect(extractionPrompts()[0]).toContain("Acme Robotics builds");
        expect(calls.some(c => c.prompt.includes("Test Example"))).toBe(false);

        const view = profileView(metadata());
        expect(view.facts.map(f => [f.label, f.value])).toEqual([
            ["Name", "Acme Robotics"],
            ["Headquarters", "Baltimore, MD"],
        ]);
        expect(view.people.map(p => p.name)).toEqual(["Jane Doe"]);
        expect(view.summary).toBe("Acme Robotics builds warehouse robots.");
        expect(view.applicantType).toBe("for_profit");
        expect(view.evidence.every(e => e.documentId === 1)).toBe(true);
        expect(store.profile?.buildStatus).toBe("idle");
    });

    it("does not re-read unchanged sources or rewrite an unchanged summary", async () => {
        await rebuildProfile(C, ports, { changedBy: "u1" });
        const before = calls.length;
        await rebuildProfile(C, ports, { changedBy: "u1" });
        expect(calls.length).toBe(before);
    });

    it("keeps a person's edit across a forced re-read", async () => {
        await rebuildProfile(C, ports, { changedBy: "u1" });
        const edited = structuredClone(metadata());
        applyFactEdit(edited, { path: "company.headquarters", value: "Remote-first" });
        store.profile = { ...store.profile!, metadata: edited };
        await rebuildProfile(C, ports, { changedBy: "u1", force: true });
        expect(metadata().company.headquarters).toMatchObject({
            value: "Remote-first",
            priority: "manual_override",
        });
    });
});

describe("a person's override and a changing workspace", () => {
    it("counting a set-aside source reads it for facts; setting it aside again removes them", async () => {
        await rebuildProfile(C, ports, { changedBy: "u1" });
        await recordOverride(C, 2, "about_us", "u1");
        await refreshForDocument(C, 2, ports);
        const paperPrompt = extractionPrompts().find(p => p.includes("Dense X Retrieval"));
        // The extractor is told a person vouched for it, so the paper's "we" is the organisation.
        expect(paperPrompt).toContain("marked this document as written by or about Acme Robotics");
        expect(profileView(metadata()).facts.map(f => f.label)).toContain("Partners");

        await recordOverride(C, 2, "set_aside", "u1");
        await refreshForDocument(C, 2, ports);
        expect(profileView(metadata()).facts.map(f => f.label)).not.toContain("Partners");
    });

    it("a deleted source takes its facts with it", async () => {
        await rebuildProfile(C, ports, { changedBy: "u1" });
        store.docs.delete(1);
        store.rows.delete(1); // the FK cascade
        await assembleProfile(C, ports, { changedBy: "system" });
        const view = profileView(metadata());
        expect(view.facts).toEqual([]);
        expect(view.people).toEqual([]);
    });

    it("a new version is re-read, and what it no longer says goes", async () => {
        await rebuildProfile(C, ports, { changedBy: "u1" });
        store.docs.set(1, doc(1, "Acme deck.pdf", 12));
        store.chunks.set("1:12", [
            chunk(
                102,
                "Rewritten deck. Acme Robotics builds warehouse robots. We moved our headquarters to Austin, TX. Our robots now serve regional grocers in Texas and Oklahoma.",
                "Acme deck.pdf"
            ),
        ]);
        await readSource(C, 1, ports);
        expect(row(1).versionId).toBe(12n);
        await assembleProfile(C, ports, { changedBy: "system" });
        expect(metadata().company.headquarters?.value).toBe("Austin, TX");
        expect(metadata().people).toEqual([]);
    });
});

describe("builds that overlap, and the first event after upgrading", () => {
    const SITE =
        "Acme Robotics serves grocers across Texas. Our team answers support questions within one business day, and our robots ship with a two-year warranty.";

    it("a slow reassembly that drafted before an upload landed still saves the upload's facts", async () => {
        await rebuildProfile(C, ports, { changedBy: "u1" });
        // Force the next reassembly to write a summary, and make that call slow.
        store.profile!.metadata = {
            ...(store.profile!.metadata as CompanyMetadataJSON),
            provenance: { ...metadata().provenance, facts_hash: "stale" },
        };
        slowSummaries.push(40);
        const slow = assembleProfile(C, ports, { changedBy: "delete" }); // drafts now, saves last
        await new Promise(r => setTimeout(r, 5));
        store.docs.set(4, doc(4, "Acme site.md", 41));
        store.chunks.set("4:41", [chunk(401, SITE, "Acme site.md")]);
        await refreshForDocument(C, 4, ports); // reads the new source and saves first
        await slow;
        const m = metadata();
        expect(m.company.headquarters?.value).toBe("Baltimore, MD");
        expect(m.markets.geographies?.map(f => f.value)).toEqual(["Texas"]);
    });

    it("the first upload after upgrading reads every source, so the profile does not collapse to one document", async () => {
        store.docs.set(4, doc(4, "Acme site.md", 41));
        store.chunks.set("4:41", [chunk(401, SITE, "Acme site.md")]);
        // A profile from before this builder: built, no source rows.
        store.profile = {
            buildStatus: "idle",
            builtAt: new Date("2026-09-01"),
            metadata: {
                schema_version: "1.0.0",
                company_id: "50",
                updated_at: "",
                company: {},
                people: [],
                services: [],
                markets: {},
                projects: [],
                policies: {},
                legal: [],
                provenance: {
                    total_documents_processed: 3,
                    extraction_model: "",
                    extraction_version: "1.0.0",
                },
            },
        };
        await refreshForDocument(C, 4, ports);
        expect(extractionPrompts().some(p => p.includes("Acme Robotics builds"))).toBe(true);
        expect(metadata().company.headquarters?.value).toBe("Baltimore, MD");
        expect(metadata().markets.geographies?.map(f => f.value)).toEqual(["Texas"]);
        expect(row(2).role).toBe("third_party");
    });
});
