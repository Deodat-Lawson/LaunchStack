import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
    dispatchWithLedger,
    initializeRequestLedger,
    inspectRequestLedger,
    openPhaseB,
    PHASE_A_CASES,
    PHASE_B_CASES,
    type ModelRequestMetadata,
    type PhaseBGate,
} from "./request-ledger";
const H = "a".repeat(64);
const roots: string[] = [];
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "vantage-ledger-test-"));
    roots.push(root);
    const directory = join(root, "requests");
    await initializeRequestLedger(directory, { runId: "pilot", frozenSpecHash: H });
    return directory;
}
afterEach(async () => {
    for (const root of roots.splice(0)) {
        if (
            !resolve(root)
                .toLowerCase()
                .startsWith((resolve(tmpdir()) + sep + "vantage-ledger-test-").toLowerCase())
        )
            throw new Error("Unsafe test cleanup path");
        await rm(root, { recursive: true, force: true });
    }
});
function metadata(overrides: Partial<ModelRequestMetadata> = {}): ModelRequestMetadata {
    return {
        intentId: "a-gen-1",
        phase: "A",
        caseId: PHASE_A_CASES[0],
        kind: "initial-generation",
        modelId: "synthetic-test-model",
        modelConfigHash: H,
        promptHash: H,
        inputHash: H,
        ...overrides,
    };
}
const ok = async () => ({
    value: "test-response",
    receipt: {
        httpStatus: 200,
        providerRequestId: "synthetic-request",
        responseModel: "synthetic-test-model",
        usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
        costUsd: 0.01,
        costBasis: "estimated-configured-rates" as const,
    },
});
async function pilot(directory: string, recoveries = 0) {
    for (const caseId of PHASE_A_CASES) {
        for (const kind of ["initial-generation", "initial-judge"] as const)
            await dispatchWithLedger(
                directory,
                metadata({ intentId: `A/${caseId}/${kind}`, caseId, kind }),
                ok
            );
    }
    for (let i = 0; i < recoveries; i++)
        await dispatchWithLedger(
            directory,
            metadata({
                intentId: `A/recovery/${i}`,
                kind: "recovery",
                recovery: {
                    purpose: "verification",
                    reason: "Synthetic failure diagnosis",
                    authorizationRef: "test-only-approval",
                },
            }),
            ok
        );
}
function gate(): PhaseBGate {
    return {
        authorizationRef: "test-only-conditional-batch",
        pilotCases: PHASE_A_CASES.map(caseId => ({
            caseId,
            generationIntentId: `A/${caseId}/initial-generation`,
            judgeIntentId: `A/${caseId}/initial-judge`,
            generationValidated: true,
            criticalExpectationsSatisfied: true,
            semanticAssessmentValid: true,
            sourceIntegrityVerified: true,
            assessmentArtifactHash: H,
        })),
        pricing: { status: "user-waived", authorizationRef: "synthetic-user-pricing-amendment" },
        judgeIndependence: {
            mode: "same-model-separate-blinded-calls-user-approved",
            authorizationRef: "synthetic-user-same-model-amendment",
            protocolHash: H,
        },
        batchFreeze: {
            scenarioCount: 14,
            repetitions: 3,
            inputsHash: H,
            expectationsHash: H,
            modelsHash: H,
            rubricHash: H,
            protocolHash: H,
        },
    };
}
async function editState(directory: string, update: (state: Record<string, unknown>) => void) {
    const value = JSON.parse(await readFile(join(directory, "ledger.json"), "utf8")) as Record<
        string,
        unknown
    >;
    update(value);
    delete value.checksum;
    value.checksum = createHash("sha256").update(JSON.stringify(value)).digest("hex");
    await writeFile(join(directory, "ledger.json"), JSON.stringify(value), "utf8");
}

describe("persistent shared provider request ledger (no real providers)", () => {
    it("records one exact dispatch, receipt, usage and post-response cost", async () => {
        const directory = await fixture(),
            send = vi.fn(ok);
        expect(await dispatchWithLedger(directory, metadata(), send)).toBe("test-response");
        const ledger = await inspectRequestLedger(directory);
        expect(send).toHaveBeenCalledOnce();
        expect(ledger.counts).toMatchObject({
            consumedSlots: 1,
            confirmedProviderResponses: 1,
            inFlightOrCrashUncertain: 0,
        });
        expect(ledger.state.records[0]).toMatchObject({
            status: "responded",
            receipt: { usage: { totalTokens: 18 }, costUsd: 0.01 },
        });
    });
    it("never resets an existing ledger and rejects duplicate intents after reopening", async () => {
        const directory = await fixture();
        await dispatchWithLedger(directory, metadata(), ok);
        await expect(
            initializeRequestLedger(directory, { runId: "pilot", frozenSpecHash: H })
        ).rejects.toThrow("never reset");
        const send = vi.fn(ok);
        await expect(dispatchWithLedger(directory, metadata(), send)).rejects.toThrow(
            "already consumed"
        );
        expect(send).not.toHaveBeenCalled();
        expect((await inspectRequestLedger(directory)).counts.consumedSlots).toBe(1);
    });
    it("rejects a second initial allocation even with a different intent ID", async () => {
        const directory = await fixture();
        await dispatchWithLedger(directory, metadata(), ok);
        await expect(
            dispatchWithLedger(directory, metadata({ intentId: "hidden-auto-retry" }), ok)
        ).rejects.toThrow("already consumed");
        expect((await inspectRequestLedger(directory)).counts.consumedSlots).toBe(1);
    });
    it("charges HTTP errors and thrown transport errors without implicit retries", async () => {
        const directory = await fixture(),
            failure = vi.fn(async () => {
                throw new Error("Never serialize a credential-bearing exception message");
            });
        await expect(dispatchWithLedger(directory, metadata(), failure)).rejects.toThrow(
            "credential-bearing"
        );
        await dispatchWithLedger(
            directory,
            metadata({
                intentId: "explicit-recovery",
                kind: "recovery",
                recovery: {
                    purpose: "generation",
                    reason: "Recorded transport failure",
                    authorizationRef: "test-user-approval",
                },
            }),
            async () => ({ value: "provider-error", receipt: { httpStatus: 429 } })
        );
        const ledger = await inspectRequestLedger(directory);
        expect(failure).toHaveBeenCalledOnce();
        expect(ledger.counts.consumedSlots).toBe(2);
        expect(ledger.counts.confirmedProviderResponses).toBe(1);
        expect(ledger.state.records.map(record => record.status)).toEqual(["failed", "failed"]);
        expect(JSON.stringify(ledger)).not.toContain("credential-bearing");
    });
    it("counts a redirect response but never treats it as a successful model response", async () => {
        const directory = await fixture();
        await dispatchWithLedger(directory, metadata(), async () => ({
            value: "redirect-not-followed",
            receipt: { httpStatus: 307 },
        }));
        const ledger = await inspectRequestLedger(directory);
        expect(ledger.state.records[0]?.status).toBe("failed");
        expect(ledger.counts).toMatchObject({ consumedSlots: 1, confirmedProviderResponses: 1 });
    });
    it("requires explicit recovery attribution and limits it to four attempts", async () => {
        const directory = await fixture();
        await expect(
            dispatchWithLedger(directory, metadata({ kind: "recovery" }), ok)
        ).rejects.toThrow("reason");
        for (let i = 0; i < 4; i++)
            await dispatchWithLedger(
                directory,
                metadata({
                    intentId: `recovery-${i}`,
                    kind: "recovery",
                    recovery: {
                        purpose: "verification",
                        reason: "Recorded check",
                        authorizationRef: "test-approval",
                    },
                }),
                ok
            );
        await expect(
            dispatchWithLedger(
                directory,
                metadata({
                    intentId: "fifth",
                    kind: "recovery",
                    recovery: {
                        purpose: "judge",
                        reason: "Extra",
                        authorizationRef: "test-approval",
                    },
                }),
                ok
            )
        ).rejects.toThrow("ceiling");
    });
    it("fails closed for a corrupt file, ownership change and checksum mismatch", async () => {
        for (const corrupt of ["{", "checksum", "owner"]) {
            const directory = await fixture();
            if (corrupt === "{") await writeFile(join(directory, "ledger.json"), "{");
            else if (corrupt === "checksum") {
                const state = JSON.parse(await readFile(join(directory, "ledger.json"), "utf8"));
                state.revision++;
                await writeFile(join(directory, "ledger.json"), JSON.stringify(state));
            } else {
                const owner = JSON.parse(await readFile(join(directory, "owner.json"), "utf8"));
                owner.frozenSpecHash = "b".repeat(64);
                await writeFile(join(directory, "owner.json"), JSON.stringify(owner));
            }
            const send = vi.fn(ok);
            await expect(dispatchWithLedger(directory, metadata(), send)).rejects.toThrow(
                "corrupt"
            );
            expect(send).not.toHaveBeenCalled();
        }
    });
    it("does not remove stale locks or dispatch while another request is inflight", async () => {
        const directory = await fixture();
        await writeFile(join(directory, "ledger.lock"), "simulated-crash-lock");
        const send = vi.fn(ok);
        await expect(dispatchWithLedger(directory, metadata(), send)).rejects.toThrow("locked");
        expect(send).not.toHaveBeenCalled();
        expect(await readFile(join(directory, "ledger.lock"), "utf8")).toBe("simulated-crash-lock");
    });
    it("blocks an overlapping request and exposes the uncertain admitted slot", async () => {
        const directory = await fixture();
        let finish!: () => void;
        const pending = dispatchWithLedger(directory, metadata(), async () => {
            await new Promise<void>(resolve => {
                finish = resolve;
            });
            return ok();
        });
        await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
        const ledger = await inspectRequestLedger(directory);
        expect(ledger.counts).toMatchObject({
            consumedSlots: 1,
            confirmedProviderResponses: 0,
            inFlightOrCrashUncertain: 1,
        });
        await expect(
            dispatchWithLedger(
                directory,
                metadata({ intentId: "other", caseId: PHASE_A_CASES[1] }),
                ok
            )
        ).rejects.toThrow("crash-uncertain");
        finish();
        await pending;
    });
    it("leaves crash-uncertain admissions charged and refuses future dispatch", async () => {
        const directory = await fixture();
        await dispatchWithLedger(directory, metadata(), ok);
        await editState(directory, state => {
            const records = state.records as Array<Record<string, unknown>>;
            Object.assign(records[0]!, {
                status: "dispatch-started",
                receipt: null,
                terminalAt: null,
                failure: null,
            });
        });
        await expect(
            dispatchWithLedger(
                directory,
                metadata({ intentId: "next", caseId: PHASE_A_CASES[1] }),
                ok
            )
        ).rejects.toThrow("manual reconciliation");
        expect((await inspectRequestLedger(directory)).counts.inFlightOrCrashUncertain).toBe(1);
    });
    it("rejects Phase B before five passing receipt-bound pilot assessments", async () => {
        const directory = await fixture();
        const b = metadata({
            phase: "B",
            caseId: "C01",
            repetition: 1,
            kind: "candidate-d-generation",
        });
        await expect(dispatchWithLedger(directory, b, ok)).rejects.toThrow("unopened Phase B");
        await expect(openPhaseB(directory, gate())).rejects.toThrow("pilot gate");
        await pilot(directory);
        const bad = gate();
        bad.pilotCases[0]!.judgeIntentId = bad.pilotCases[0]!.generationIntentId;
        await expect(openPhaseB(directory, bad)).rejects.toThrow("pilot gate");
        await openPhaseB(directory, gate());
        await expect(openPhaseB(directory, gate())).rejects.toThrow("already frozen");
        await dispatchWithLedger(directory, b, ok);
    });
    it("records user-waived pricing and approved same-model judging truthfully", async () => {
        const directory = await fixture();
        await pilot(directory);
        const mismatched = gate();
        if (mismatched.judgeIndependence.mode !== "same-model-separate-blinded-calls-user-approved")
            throw new Error("Invalid test setup");
        mismatched.judgeIndependence.protocolHash = "b".repeat(64);
        await expect(openPhaseB(directory, mismatched)).rejects.toThrow("frozen blinded protocol");
        const ledger = await openPhaseB(directory, gate());
        expect(ledger.state.phaseBGate?.pricing).toEqual({
            status: "user-waived",
            authorizationRef: "synthetic-user-pricing-amendment",
        });
        expect(ledger.state.phaseBGate?.judgeIndependence.mode).toBe(
            "same-model-separate-blinded-calls-user-approved"
        );
        expect(ledger.state.phaseBGate?.pricing).not.toHaveProperty("verified");
    });
    it("requires evidence for a verified pricing claim rather than inventing a waiver", async () => {
        const directory = await fixture();
        await pilot(directory);
        const validated = { ...gate(), pricing: { status: "verified" as const, evidenceHash: H } };
        await openPhaseB(directory, validated);
        expect((await inspectRequestLedger(directory)).state.phaseBGate?.pricing).toEqual({
            status: "verified",
            evidenceHash: H,
        });
    });
    it("rejects extra role/scenario variants and repairs without an initial V2 attempt", async () => {
        const directory = await fixture();
        await pilot(directory);
        await openPhaseB(directory, gate());
        await expect(
            dispatchWithLedger(
                directory,
                metadata({
                    phase: "B",
                    caseId: "C01-role-variant",
                    kind: "candidate-d-generation",
                    repetition: 1,
                }),
                ok
            )
        ).rejects.toThrow("invalid");
        await expect(
            dispatchWithLedger(
                directory,
                metadata({ phase: "B", caseId: "C01", kind: "v21-repair", repetition: 1 }),
                ok
            )
        ).rejects.toThrow("earlier initial");
    });
    it("enforces all fixed category, phase and combined ceilings without transfers", async () => {
        const directory = await fixture();
        await pilot(directory, 4);
        await openPhaseB(directory, gate());
        for (const caseId of PHASE_B_CASES)
            for (const repetition of [1, 2, 3])
                for (const kind of [
                    "candidate-d-generation",
                    "v21-generation",
                    "v21-repair",
                    "pairwise-judge",
                ] as const)
                    await dispatchWithLedger(
                        directory,
                        metadata({
                            intentId: `B/${caseId}/${repetition}/${kind}`,
                            phase: "B",
                            caseId,
                            repetition,
                            kind,
                        }),
                        ok
                    );
        const ledger = await inspectRequestLedger(directory);
        expect(ledger.counts).toMatchObject({
            consumedSlots: 182,
            phaseA: 14,
            phaseB: 168,
            confirmedProviderResponses: 182,
        });
        expect(ledger.remaining).toEqual({ phaseA: 0, phaseB: 0, combined: 0 });
        await expect(
            dispatchWithLedger(
                directory,
                metadata({
                    intentId: "extra",
                    kind: "recovery",
                    recovery: {
                        purpose: "verification",
                        reason: "Over cap",
                        authorizationRef: "test",
                    },
                }),
                ok
            )
        ).rejects.toThrow("ceiling");
        await expect(
            dispatchWithLedger(
                directory,
                metadata({
                    intentId: "extra-B",
                    phase: "B",
                    caseId: "C01",
                    repetition: 1,
                    kind: "candidate-d-generation",
                }),
                ok
            )
        ).rejects.toThrow();
    }, 30000);
    it("shares its final Phase A slot atomically across separate Node processes", async () => {
        const directory = await fixture();
        await pilot(directory, 3);
        const moduleUrl = new URL("./request-ledger.ts", import.meta.url).href;
        const cwd = fileURLToPath(new URL("../../../../", import.meta.url));
        const run = (index: number) =>
            new Promise<string>((resolvePromise, reject) => {
                const m = metadata({
                    intentId: `child-${index}`,
                    kind: "recovery",
                    recovery: {
                        purpose: "verification",
                        reason: "Cross-process cap check",
                        authorizationRef: "test",
                    },
                });
                const code = `import {dispatchWithLedger} from ${JSON.stringify(moduleUrl)};try{await dispatchWithLedger(${JSON.stringify(directory)},${JSON.stringify(m)},async()=>{await new Promise(r=>setTimeout(r,40));return {value:true,receipt:{httpStatus:200}}});console.log('accepted')}catch{console.log('blocked')}`;
                const child = spawn(
                    process.execPath,
                    ["--import", "tsx", "--input-type=module", "-e", code],
                    { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
                );
                let output = "",
                    errors = "";
                child.stdout.on("data", value => {
                    output += value;
                });
                child.stderr.on("data", value => {
                    errors += value;
                });
                child.on("error", reject);
                child.on("exit", code =>
                    code === 0 ? resolvePromise(output.trim()) : reject(new Error(errors))
                );
            });
        const outcomes = await Promise.all([0, 1, 2, 3].map(run));
        expect(outcomes.filter(value => value === "accepted")).toHaveLength(1);
        expect((await inspectRequestLedger(directory)).counts.phaseA).toBe(14);
    }, 30000);
    it("rejects invalid receipt data while preserving consumed uncertainty", async () => {
        const directory = await fixture();
        await expect(
            dispatchWithLedger(directory, metadata(), async () => ({
                value: true,
                receipt: { httpStatus: 999 },
            }))
        ).rejects.toThrow("invalid transport receipt");
        const ledger = await inspectRequestLedger(directory);
        expect(ledger.counts).toMatchObject({
            consumedSlots: 1,
            confirmedProviderResponses: 0,
            unconfirmedDispatchSlots: 1,
        });
    });
});
