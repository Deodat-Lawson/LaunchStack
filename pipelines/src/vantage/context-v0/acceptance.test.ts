import { describe, expect, it } from "vitest";
import normalFixture from "../../../../fixtures/vantage-context-v0/normal.json";
import { ContextPortErrorV0, runContextV0Pipeline } from "./adapters";
import { createFixtureV0Ports } from "./mocks";
import type { FixtureV0Input, FixtureV0Overrides } from "./mocks";
import type { ContextSourceEntryV0 } from "../proposals/context-v0";

const fixtureInput = normalFixture as unknown as FixtureV0Input;

const input = {
    principalRef: "user-joseph",
    companyId: "company-tilde",
    reportWindow: {
        startInclusive: "2026-10-12T00:00:00Z",
        endExclusive: "2026-10-19T00:00:00Z",
        asOf: "2026-10-19T12:00:00Z",
    },
    budgets: {
        maxSources: 20,
        maxExcerptChars: 8000,
        timeoutMs: 5000,
        maxQueries: 2,
        maxTokens: 1200,
    },
    runId: "acceptance-context-v0",
    inputVersion: "acceptance-input-v0",
};

const clone = <T>(value: T): T => structuredClone(value);
const createPorts = (overrides: FixtureV0Overrides = {}) =>
    createFixtureV0Ports(fixtureInput, overrides);

describe("Vantage context v0 acceptance matrix", () => {
    it("assembles Founder + Engineering roles, including the older unresolved personal star", async () => {
        const base = createPorts();
        const ports = createPorts({
            roleContext: {
                ...base.fixture.roleContext,
                roleIds: ["founder", "engineering"],
                primaryRoleId: "founder",
                roles: [
                    ...base.fixture.roleContext.roles,
                    {
                        roleId: "engineering",
                        description: "Engineering",
                        responsibilities: ["Ship reliably"],
                        priorities: ["Reduce delivery risk"],
                    },
                ],
            },
        });
        const output = await runContextV0Pipeline(input, ports);

        expect(output.manifest.roleIds).toEqual(["engineering", "founder"]);
        // STOP is represented as a partial context state even when retrieval is complete.
        expect(output.manifest.status).toBe("partial");
        expect(output.evidenceSnapshot.entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    source: { kind: "doc", id: "doc-starred-roadmap", version: "doc-v4" },
                }),
            ])
        );
    });

    it("keeps a recent but irrelevant catalog source out of the evidence snapshot", async () => {
        const irrelevant: ContextSourceEntryV0 = {
            source: { kind: "doc", id: "doc-recent-irrelevant", version: "doc-v1" },
            companyId: "company-tilde",
            access: "allowed",
            aclDigest: "acl-tilde-company-1",
            audience: { kind: "company", companyId: "company-tilde" },
            sourceDate: "2026-10-18T15:00:00Z",
            checkedAt: "2026-10-19T11:00:00Z",
            excerpt: "Recent unrelated material.",
        };
        const ports = createPorts({
            sourceCatalog: [...clone(fixtureInput.retrievalInput.sourceCatalog), irrelevant],
        });
        const output = await runContextV0Pipeline(input, ports);

        expect(
            output.evidenceSnapshot.entries.some(item => item.source.id === irrelevant.source.id)
        ).toBe(false);
        expect(output.manifest.coverage.omitted).not.toContainEqual(irrelevant.source);
    });

    it.each(["partial", "timeout"] as const)(
        "preserves retrieval %s independently from research STOP",
        async status => {
            const base = createPorts();
            const retrieval = clone(base.fixture.retrieval);
            retrieval.status = status;
            if (status === "timeout") {
                retrieval.failures = [{ code: "timeout", message: "fixture timeout" }];
            }
            const ports = createPorts({ retrieval });
            const output = await runContextV0Pipeline(input, ports);

            expect(output.research.mode).toBe("STOP");
            expect(output.research.status).toBe("stopped");
            expect(output.manifest.retrievalState.status).toBe(status);
            expect(output.manifest.research.status).toBe("stopped");
            expect(output.manifest.status).toBe("partial");
        }
    );

    it("marks optional research unavailable without changing retrieval state", async () => {
        const ports = createPorts();
        ports.planResearch = () => ({
            contractVersion: "v0-proposed",
            mode: "internal",
            gapPurpose: "Optional internal check",
            internalSourceRefs: [],
            publicSafeQueryProjection: [],
            budgets: input.budgets,
        });
        ports.research = undefined;
        const output = await runContextV0Pipeline(input, ports);

        expect(output.research.status).toBe("failed");
        expect(output.research.failures).toEqual([
            expect.objectContaining({ code: "source_unavailable" }),
        ]);
        expect(output.manifest.retrievalState.status).toBe("complete");
        expect(output.manifest.research.status).toBe("failed");
        expect(output.manifest.research.failures).toEqual(
            expect.arrayContaining([expect.objectContaining({ code: "source_unavailable" })])
        );
        expect(output.manifest.status).toBe("partial");
    });

    it.each(["missing", "revoked"] as const)(
        "blocks a %s required source before snapshot assembly",
        async state => {
            const base = createPorts();
            const required = clone(base.fixture.requiredContext);
            const mandatory = required.workspaceMandatoryDocuments[0];
            if (!mandatory) throw new Error("The fixture must contain a mandatory document");
            const ref = mandatory.source;
            if (state === "missing") {
                required.status = "partial";
                required.coverage.missing = [ref];
            } else {
                required.status = "blocked";
                required.coverage.revoked = [ref];
                required.workspaceMandatoryDocuments[0] = {
                    ...mandatory,
                    access: "revoked",
                    excerpt: "",
                };
            }
            const ports = createPorts({ requiredContext: required });

            await expect(runContextV0Pipeline(input, ports)).rejects.toMatchObject({
                status: state === "revoked" ? 403 : 409,
            });
        }
    );

    it("rejects cross-actor requests and cross-company research sources", async () => {
        const actorPorts = createPorts();
        actorPorts.server.resolveAuthenticatedActor = async () => ({
            ...actorPorts.fixture.requiredContext.actor,
            principalRef: "another-user",
        });
        await expect(runContextV0Pipeline(input, actorPorts)).rejects.toBeInstanceOf(
            ContextPortErrorV0
        );

        const sourcePorts = createPorts();
        sourcePorts.planResearch = () => ({
            contractVersion: "v0-proposed",
            mode: "internal",
            gapPurpose: "cross-company probe",
            internalSourceRefs: [{ kind: "doc", id: "doc-weekly-plan", version: "doc-v7" }],
            publicSafeQueryProjection: [],
            budgets: input.budgets,
        });
        const mandatory = fixtureInput.requiredBundle.workspaceMandatoryDocuments[0];
        if (!mandatory) throw new Error("The fixture must contain a mandatory document");
        sourcePorts.server.sourceCatalog = async () => [
            ...clone(fixtureInput.retrievalInput.sourceCatalog),
            {
                ...clone(mandatory),
                source: { kind: "doc", id: "doc-foreign", version: "doc-v1" },
                companyId: "another-company",
            },
        ];
        sourcePorts.planResearch = () => ({
            contractVersion: "v0-proposed",
            mode: "internal",
            gapPurpose: "cross-company probe",
            internalSourceRefs: [{ kind: "doc", id: "doc-foreign", version: "doc-v1" }],
            publicSafeQueryProjection: [],
            budgets: input.budgets,
        });
        // The source is rejected before Sophia is invoked, at the retrieval
        // input boundary, so this is a 409 contract violation rather than a
        // research-provider permission response.
        await expect(runContextV0Pipeline(input, sourcePorts)).rejects.toMatchObject({
            status: 409,
        });
    });

    it.each(["profile", "content", "source ACL"] as const)(
        "rejects a %s change after assembly",
        async change => {
            const ports = createPorts();
            const original = ports.server.currentState;
            ports.server.currentState = async request => {
                const state = await original(request);
                if (change === "profile") {
                    return {
                        ...state,
                        roleProfileVersions: {
                            ...state.roleProfileVersions,
                            founder: "profile-v2",
                        },
                    };
                }
                if (change === "content") {
                    const key = Object.keys(state.sourceFingerprints)[0]!;
                    return {
                        ...state,
                        sourceFingerprints: {
                            ...state.sourceFingerprints,
                            [key]: "changed-content",
                        },
                    };
                }
                return { ...state, actorAclDigest: "changed-acl" };
            };
            await expect(runContextV0Pipeline(input, ports)).rejects.toMatchObject({
                status: change === "source ACL" ? 403 : 409,
            });
        }
    );
});
