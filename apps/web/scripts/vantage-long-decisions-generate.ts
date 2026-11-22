/** Explicitly gated generation-only Azure CLI. All artefacts stay in a dedicated external directory. */
import {
    readFile,
    readdir,
    writeFile,
    mkdir,
    realpath,
    access,
    rename,
    open,
    unlink,
} from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
    planAzureLive,
    AZURE_LUNA_DEPLOYMENT,
    AZURE_LUNA_RESERVATION_PER_MILLION,
} from "./vantage-benchmark-azure-plan";
import { createBenchmarkMeter, type BenchmarkMeterSnapshot } from "./vantage-benchmark-meter";
import {
    validateNoHttpRecovery,
    generationBody,
    generationProjection,
    sectionTarget,
    validateVersionLabels,
    corpusValidationSummary,
    runCanaryThenPool,
    validateSpec,
    genericPrompt,
    fitSectionParagraphs,
    assembleVersion,
    publicManifest,
    sha256,
    SECTION_COUNT,
    MAX_ATTEMPTS,
    MAX_OUTPUT_TOKENS,
    type Assembled,
} from "./vantage-long-decisions-generate-core";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const LIMIT_USD = 3;
const completionSchema = z.object({
    choices: z
        .array(
            z.object({
                finish_reason: z.literal("stop"),
                message: z.object({ content: z.string().min(1), refusal: z.null().optional() }),
            })
        )
        .length(1),
});
async function external(path: string) {
    const value = await realpath(path),
        offset = relative(await realpath(repository), value);
    if (!offset || (!isAbsolute(offset) && offset !== ".." && !offset.startsWith(".." + sep)))
        throw Error("long_generation_external_directory_required");
    for (let p = value; ; p = dirname(p)) {
        try {
            await access(resolve(p, ".git"));
            throw Error("long_generation_external_directory_required");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (dirname(p) === p) break;
    }
    return value;
}
async function readOptional(path: string) {
    try {
        return await readFile(path, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}
async function atomic(path: string, value: unknown) {
    const temporary = path + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", flush: true });
    await rename(temporary, path);
}
async function main() {
    const { values } = parseArgs({
        options: {
            spec: { type: "string" },
            output: { type: "string" },
            "canary-only": { type: "boolean", default: false },
            execute: { type: "boolean", default: false },
            resume: { type: "boolean", default: false },
            "recover-no-http": { type: "boolean", default: false },
            "approved-spec-sha256": { type: "string" },
        },
    });
    if (values["recover-no-http"] && (!values.resume || !values.execute))
        throw Error("long_generation_recovery_resume_required");
    if (!values.spec) throw Error("long_generation_spec_required");
    const specBytes = await readFile(resolve(values.spec)),
        specSha256 = sha256(specBytes);
    const spec = validateSpec(JSON.parse(specBytes.toString("utf8")));
    const projection = generationProjection(
        spec,
        AZURE_LUNA_DEPLOYMENT,
        AZURE_LUNA_RESERVATION_PER_MILLION
    );
    if (projection.worstCaseUsd > LIMIT_USD)
        throw Error("long_generation_objective_budget_exceeded");
    const totalVersions = spec.documents.reduce((n, d) => n + d.versions.length, 0);
    if (!values.execute) {
        console.log(
            JSON.stringify({
                mode: "plan_only",
                projection,
                specSha256,
                documents: spec.documents.length,
                versions: totalVersions,
                sections: totalVersions * SECTION_COUNT,
                maxAttempts: MAX_ATTEMPTS,
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                limitUsd: LIMIT_USD,
            })
        );
        return;
    }
    if (values["approved-spec-sha256"] !== specSha256)
        throw Error("long_generation_approved_spec_required");
    if (!values.output) throw Error("long_generation_output_required");
    // Creating a new dedicated leaf below an already existing external parent avoids path/symlink surprises.
    const parent = await external(dirname(resolve(values.output))),
        directory = resolve(parent, values.output.split(/[\\/]/).at(-1)!);
    if (!values.resume) await mkdir(directory);
    const output = await external(directory);
    const lease = await open(resolve(output, "generator.lock"), "wx");
    try {
        const binding = {
            schemaVersion: "long-decisions-generation/1",
            specSha256,
            limitUsd: LIMIT_USD,
            model: AZURE_LUNA_DEPLOYMENT,
            sections: SECTION_COUNT,
            maxAttempts: MAX_ATTEMPTS,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
        };
        const priorBinding = await readOptional(resolve(output, "generation-config.json"));
        if (priorBinding && JSON.stringify(JSON.parse(priorBinding)) !== JSON.stringify(binding))
            throw Error("long_generation_resume_binding_invalid");
        if (!priorBinding) await atomic(resolve(output, "generation-config.json"), binding);
        const priorText = await readOptional(resolve(output, "usage-ledger.json"));
        if (values.resume && !priorText) throw Error("long_generation_resume_ledger_missing");
        const priorLedger = priorText
            ? (JSON.parse(priorText) as BenchmarkMeterSnapshot)
            : undefined;
        const orderedVersions = spec.documents.flatMap(document =>
            document.versions.map(version => ({ document, version }))
        );
        const recoveryPath = resolve(output, "generation-no-http-recovery.json");
        const receiptText = await readOptional(recoveryPath);
        const receiptSchema = z
            .object({
                schemaVersion: z.literal("long-decisions-no-http-recovery/1"),
                specSha256: z.string(),
                priorLedgerSha256: z.string(),
                unknownRecordIds: z.array(z.string()).min(1),
                attempts: z
                    .array(z.object({ file: z.string(), promptSha256: z.string() }).strict())
                    .min(1),
                acknowledged: z.literal(true),
            })
            .strict();
        const receipt = receiptText ? receiptSchema.parse(JSON.parse(receiptText)) : undefined;
        if (receipt && values["recover-no-http"])
            throw Error("long_generation_recovery_already_used");
        const consumed = new Map<string, string>();
        if (receipt) {
            if (
                !priorLedger ||
                receipt.specSha256 !== specSha256 ||
                receipt.unknownRecordIds.some(
                    id =>
                        !priorLedger.records.some(
                            row =>
                                row.id === id &&
                                row.status === "unknown" &&
                                row.continuedAfterGenerationNoHttp &&
                                row.httpStatus === undefined &&
                                row.route === "digest" &&
                                row.projectedUsd > 0 &&
                                row.settledListRateUsd === undefined
                        )
                )
            )
                throw Error("long_generation_recovery_receipt_invalid");
            for (const attempt of receipt.attempts) {
                if (!/^[A-Za-z0-9_-]+\.s[0-4]\.a[01]\.json\.started$/.test(attempt.file))
                    throw Error("long_generation_recovery_receipt_invalid");
                const started = await readOptional(resolve(output, attempt.file));
                if (
                    !started ||
                    JSON.parse(started).promptSha256 !== attempt.promptSha256 ||
                    (await readOptional(resolve(output, attempt.file.slice(0, -8))))
                )
                    throw Error("long_generation_recovery_receipt_invalid");
                consumed.set(attempt.file, attempt.promptSha256);
            }
        }
        const recoveryAttempts = [];
        if (values["recover-no-http"]) {
            for (const file of (await readdir(output))
                .filter(file => file.endsWith(".json.started"))
                .sort()) {
                if (await readOptional(resolve(output, file.slice(0, -8)))) continue;
                const match = /^([A-Za-z0-9_-]+)\.s([0-4])\.a([01])\.json\.started$/.exec(file);
                const pair = match && orderedVersions.find(item => item.version.id === match[1]);
                if (!match || !pair) throw Error("long_generation_recovery_binding_invalid");
                const section = Number(match[2]),
                    attempt = Number(match[3]),
                    completed: string[] = [];
                for (let earlier = 0; earlier < section; earlier++) {
                    let accepted: string | undefined;
                    for (
                        let previousAttempt = 0;
                        previousAttempt < MAX_ATTEMPTS;
                        previousAttempt++
                    ) {
                        const checkpoint = await readOptional(
                            resolve(
                                output,
                                `${pair.version.id}.s${earlier}.a${previousAttempt}.json`
                            )
                        );
                        if (!checkpoint) continue;
                        const record = JSON.parse(checkpoint);
                        if (
                            record.responseComplete !== true ||
                            typeof record.text !== "string" ||
                            sha256(record.text) !== record.textSha256
                        )
                            continue;
                        try {
                            accepted = fitSectionParagraphs(
                                record.text,
                                sectionTarget(pair.document, pair.version, completed)
                            );
                            break;
                        } catch {
                            /* rejected response consumes its attempt */
                        }
                    }
                    if (!accepted) throw Error("long_generation_recovery_binding_invalid");
                    completed.push(accepted);
                }
                const prompt = genericPrompt({
                    opaqueId: sha256(pair.version.id).slice(0, 16),
                    kind: pair.document.kind,
                    title: pair.document.title,
                    brief: pair.document.brief,
                    section,
                    targetBytes: sectionTarget(pair.document, pair.version, completed),
                    attempt,
                });
                const started = JSON.parse((await readOptional(resolve(output, file)))!);
                recoveryAttempts.push({
                    file,
                    promptSha256: started.promptSha256,
                    expectedPromptSha256: sha256(JSON.stringify(prompt)),
                });
            }
            if (!priorLedger) throw Error("long_generation_recovery_denied");
            validateNoHttpRecovery(priorLedger, recoveryAttempts);
        }
        const live = planAzureLive();
        console.log(
            JSON.stringify({
                generationPreflight: true,
                host: new URL(live.endpoint).hostname,
                model: AZURE_LUNA_DEPLOYMENT,
                projection,
                limitUsd: LIMIT_USD,
            })
        );
        const endpoint = live.endpoint.replace(/\/$/, "") + "/chat/completions";
        const meter = createBenchmarkMeter({
            allowGenerationTransportRecovery: Boolean(receipt) || values["recover-no-http"],
            limitUsd: LIMIT_USD,
            modelId: AZURE_LUNA_DEPLOYMENT,
            endpointUrl: endpoint,
            pricingSource: live.rateSource,
            pricingScope:
                "Upper Azure Standard list rates; no cache discount; generation only; invoice unverified",
            promptUsdPerToken: AZURE_LUNA_RESERVATION_PER_MILLION.input / 1e6,
            cachedPromptUsdPerToken: AZURE_LUNA_RESERVATION_PER_MILLION.input / 1e6,
            cacheWriteUsdPerToken: AZURE_LUNA_RESERVATION_PER_MILLION.input / 1e6,
            completionUsdPerToken: AZURE_LUNA_RESERVATION_PER_MILLION.output / 1e6,
            contextTokens: 32000,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            timeoutMs: 150000,
            ...(priorLedger ? { priorLedger } : {}),
            persist: snapshot => atomic(resolve(output, "usage-ledger.json"), snapshot),
        });
        // Persist empty exposure before the first request too. The meter reserves/persists before dispatch.
        if (!priorText) await atomic(resolve(output, "usage-ledger.json"), meter.snapshot());
        if (values["recover-no-http"]) {
            const audit = validateNoHttpRecovery(priorLedger!, recoveryAttempts);
            await meter.clearGenerationTransportHold(audit.unknownRecordIds.length);
            await atomic(recoveryPath, {
                schemaVersion: "long-decisions-no-http-recovery/1",
                specSha256,
                priorLedgerSha256: sha256(priorText!),
                ...audit,
                acknowledged: true,
            });
            for (const attempt of audit.attempts) consumed.set(attempt.file, attempt.promptSha256);
            console.log(
                JSON.stringify({
                    recoveredNoHttpAttempts: audit.attempts.length,
                    reservedUsd: meter.snapshot().reservedUsd,
                    exposureUsd: meter.snapshot().projectedTotalUsd,
                    concurrency: 2,
                })
            );
        }
        meter.assertCanDispatch();
        const invoke = meter.wrapFetch(globalThis.fetch),
            versions = new Map<string, Assembled>();
        const allAnchors = spec.documents.flatMap(d => d.versions.flatMap(v => v.anchors));
        const progress = new Map<string, unknown>();
        let progressWrites = Promise.resolve();
        async function generateVersion({ document, version }: (typeof orderedVersions)[number]) {
            const sections: string[] = [];
            for (let section = 0; section < SECTION_COUNT; section++) {
                const targetSectionBytes = sectionTarget(document, version, sections);
                let accepted: string | undefined;
                for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                    const prompt = genericPrompt({
                        opaqueId: sha256(version.id).slice(0, 16),
                        kind: document.kind,
                        title: document.title,
                        brief: document.brief,
                        section,
                        targetBytes: targetSectionBytes,
                        attempt,
                    });
                    const promptSha256 = sha256(JSON.stringify(prompt));
                    const checkpointPath = resolve(
                        output,
                        `${version.id}.s${section}.a${attempt}.json`
                    );
                    const cached = await readOptional(checkpointPath);
                    let text: string;
                    let responseComplete = true;
                    if (cached) {
                        const record = JSON.parse(cached);
                        if (
                            record.promptSha256 !== promptSha256 ||
                            typeof record.text !== "string" ||
                            sha256(record.text) !== record.textSha256
                        )
                            throw Error("long_generation_checkpoint_invalid");
                        text = record.text;
                        responseComplete = record.responseComplete === true;
                    } else {
                        const startedPath = checkpointPath + ".started";
                        if (await readOptional(startedPath)) {
                            if (
                                consumed.get(
                                    `${version.id}.s${section}.a${attempt}.json.started`
                                ) === promptSha256
                            )
                                continue;
                            throw Error("long_generation_checkpoint_unresolved");
                        }
                        await writeFile(startedPath, JSON.stringify({ promptSha256 }) + "\n", {
                            flag: "wx",
                            flush: true,
                        });
                        meter.assertCanDispatch();
                        const response = await invoke(endpoint, {
                            method: "POST",
                            headers: { "Content-Type": "application/json", "api-key": live.apiKey },
                            body: generationBody(prompt, AZURE_LUNA_DEPLOYMENT),
                        });
                        if (!response.ok) throw Error("long_generation_provider_failed");
                        const parsed = completionSchema.safeParse(await response.json());
                        responseComplete = parsed.success;
                        text = parsed.success ? parsed.data.choices[0]!.message.content.trim() : "";
                        await atomic(checkpointPath, {
                            promptSha256,
                            textSha256: sha256(text),
                            responseComplete,
                            text,
                        });
                    }
                    try {
                        if (!responseComplete) throw Error("long_generation_response_invalid");
                        const fitted = fitSectionParagraphs(text, targetSectionBytes);
                        if (allAnchors.some(a => text.includes(a.text) || text.includes(a.marker)))
                            throw Error("long_generation_prose_anchor_leak");
                        accepted = fitted;
                        break;
                    } catch (error) {
                        if (attempt === MAX_ATTEMPTS - 1) throw error;
                    }
                }
                if (!accepted) throw Error("long_generation_section_invalid");
                sections.push(accepted);
            }
            const result = assembleVersion(document, version, sections, allAnchors);
            validateVersionLabels(spec, version.id, result.text);
            const versionPath = resolve(output, `${version.id}.md`),
                old = await readOptional(versionPath);
            if (old !== undefined && sha256(old) !== result.sha256)
                throw Error("long_generation_existing_version_invalid");
            if (old === undefined)
                await writeFile(versionPath, result.text, { flag: "wx", flush: true });
            versions.set(version.id, result);
            progress.set(version.id, {
                documentId: document.id,
                versionId: version.id,
                sha256: result.sha256,
                bytes: result.bytes,
                anchors: result.anchors,
                sentences: result.sentences,
                repeatedSentences: result.repeatedSentences,
                repeatedSentenceRate: result.repeatedSentenceRate,
            });
            await (progressWrites = progressWrites.then(() =>
                atomic(resolve(output, "validation-private.json"), {
                    specSha256,
                    versions: orderedVersions.flatMap(item =>
                        progress.has(item.version.id) ? [progress.get(item.version.id)] : []
                    ),
                })
            ));
            console.log(
                JSON.stringify({
                    completedVersions: versions.size,
                    totalVersions,
                    bytes: result.bytes,
                    repeatedSentenceRate: result.repeatedSentenceRate,
                    exposureUsd: meter.snapshot().projectedTotalUsd,
                })
            );
        }
        // Canary is always the first spec version and finishes validation before any other dispatch.
        try {
            await runCanaryThenPool(orderedVersions, generateVersion, {
                canaryOnly: values["canary-only"],
                concurrency: 2,
                stop: () => {},
            });
        } finally {
            await progressWrites;
            await meter.drainPending();
        }
        if (values["canary-only"]) {
            console.log(
                JSON.stringify({
                    canaryComplete: true,
                    versions: 1,
                    exposureUsd: meter.snapshot().projectedTotalUsd,
                })
            );
            return;
        }
        const validation = corpusValidationSummary(spec, versions);
        await atomic(resolve(output, "validation-summary.json"), { specSha256, ...validation });
        const manifest = publicManifest(spec, specSha256, versions);
        await atomic(resolve(output, "long-decisions-manifest.json"), manifest);
        const files = orderedVersions.map(({ version }) => ({
            file: `${version.id}.md`,
            sha256: versions.get(version.id)!.sha256,
            bytes: versions.get(version.id)!.bytes,
        }));
        for (const name of [
            "generation-config.json",
            "long-decisions-manifest.json",
            "validation-private.json",
            "validation-summary.json",
            "usage-ledger.json",
        ]) {
            const bytes = await readFile(resolve(output, name));
            files.push({ file: name, sha256: sha256(bytes), bytes: bytes.length });
        }
        if (receipt || values["recover-no-http"]) {
            const bytes = await readFile(recoveryPath);
            files.push({
                file: "generation-no-http-recovery.json",
                sha256: sha256(bytes),
                bytes: bytes.length,
            });
        }
        const lock = {
            schemaVersion: "long-decisions-lock/1",
            specSha256,
            files,
            documents: spec.documents.length,
            versions: versions.size,
            model: AZURE_LUNA_DEPLOYMENT,
            limitUsd: LIMIT_USD,
            exposureUsd: meter.snapshot().projectedTotalUsd,
            billingBasis: meter.snapshot().billingBasis,
        };
        await atomic(resolve(output, "corpus-lock.json"), lock);
        for (const file of files)
            if (sha256(await readFile(resolve(output, file.file))) !== file.sha256)
                throw Error("long_generation_lock_verification_failed");
        console.log(
            JSON.stringify({
                complete: true,
                documents: spec.documents.length,
                versions: versions.size,
                lockSha256: sha256(JSON.stringify(lock)),
                exposureUsd: meter.snapshot().projectedTotalUsd,
            })
        );
    } finally {
        await lease.close();
        await unlink(resolve(output, "generator.lock"));
    }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(error => {
        console.error(
            error instanceof Error && /^long_generation_[a-z_]+$/.test(error.message)
                ? error.message
                : "long_generation_failed"
        );
        process.exitCode = 1;
    });
