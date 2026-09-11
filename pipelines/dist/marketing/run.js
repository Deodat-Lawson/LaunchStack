import { buildCompanyKnowledgeContext, extractCompanyDNA, formatCompanyIdentity, getCompanyIdentity, } from "@launchstack/tools/company-context";
import { extractBrandVoice } from "@launchstack/tools/brand-voice";
import { extractTargetPersona } from "@launchstack/tools/persona";
import { checkClaimSources } from "@launchstack/tools/claim-evidence";
import { getPlatformProfile } from "@launchstack/tools/platform-profiles";
import { rankVariants } from "@launchstack/tools/content-scoring";
import { runStage } from "@launchstack/tools/stage-runner";
import { generateVariants } from "./generator.js";
import { analyzeCompetitors } from "./competitor.js";
import { buildMultiStrategy } from "./positioning.js";
import { getPerformanceHistory, buildPerformanceInsights, saveGeneratedContent, } from "./performance.js";
import { PIPELINE_STEPS } from "./types.js";
import { researchPlatformTrends } from "./research.js";
const DEFAULT_PROMPT = "Generate a compelling campaign post for this platform.";
const LOG_PREFIX = "[marketing-pipeline]";
function normalizeInput(input) {
    const prompt = input.prompt?.trim().replace(/\s+/g, " ") ?? DEFAULT_PROMPT;
    return {
        platform: input.platform,
        prompt: prompt || DEFAULT_PROMPT,
        maxResearchResults: input.maxResearchResults ?? 6,
        platformMeta: input.platformMeta,
        toneOverride: input.toneOverride,
        targetAudience: input.targetAudience,
        contentType: input.contentType,
        enableVariantRanking: input.enableVariantRanking,
    };
}
function normalizeResearch(research) {
    return research
        .filter(r => Boolean(r.url))
        .slice(0, 12)
        .map(r => ({
        ...r,
        title: r.title.trim().replace(/\s+/g, " ").slice(0, 180),
        snippet: r.snippet.trim().replace(/\s+/g, " ").slice(0, 500),
        url: r.url.trim(),
    }));
}
function formatTrendsSummary(research) {
    if (!research.length)
        return "";
    return research
        .slice(0, 6)
        .map(r => `${r.title}: ${r.snippet.slice(0, 180)}`)
        .join("\n");
}
function stepLabel(step) {
    return PIPELINE_STEPS.find(s => s.id === step)?.label ?? step;
}
/**
 * The pipeline as a set of stage definitions over @launchstack/tools/stage-runner
 * (unification P2). Each stage declares its failure policy — "required" aborts
 * the run, "degradable" emits a failed step and continues on its fallback —
 * and its wire reporting (detail/data/narration) as colocated data. The runner
 * owns timing, progress events, error policy, and cancellation; `signal`
 * (threaded from the route's request.signal) stops an abandoned run before its
 * next stage instead of burning tokens to completion.
 */
export async function runMarketingPipeline(args) {
    const { onProgress, signal } = args;
    const pipelineStart = Date.now();
    /** Shared runner options; every stage adds its own definition on top. */
    function stage(options) {
        return runStage({
            ...options,
            label: stepLabel(options.id),
            onProgress,
            signal,
            logPrefix: LOG_PREFIX,
        });
    }
    const normalizedInput = normalizeInput(args.input);
    const userPrompt = normalizedInput.prompt ?? DEFAULT_PROMPT;
    // 1) Fetch company identity once (fast DB query); the parallel branches
    // below reuse it instead of re-querying.
    const { data: identity } = await getCompanyIdentity({ companyId: args.companyId });
    const companyName = identity.name;
    const companyIndustry = identity.industry;
    const categories = identity.categories;
    const companyIdentity = formatCompanyIdentity(identity);
    // 2) Research fan-out: KB context, DNA, competitors, trends, brand voice,
    // persona, performance history — all concurrently (parallel group 1).
    const PG_GATHER = 1;
    const [companyContextBase, dnaResult, competitors, research, brandVoice, targetPersona, performanceInsights,] = await Promise.all([
        stage({
            id: "loading-context",
            parallelGroup: PG_GATHER,
            policy: "required",
            run: () => buildCompanyKnowledgeContext({
                companyId: args.companyId,
                prompt: userPrompt,
                identity,
            }),
            report: ctx => {
                const snippetCount = ctx.split("\n").length;
                return {
                    detail: `Loaded knowledge for ${companyName}`,
                    data: { companyName, categories, snippetCount },
                    narration: `Searching knowledge base for ${companyName}... Found ${snippetCount} document snippets covering their products, services, and market position.`,
                };
            },
        }),
        stage({
            id: "extracting-dna",
            parallelGroup: PG_GATHER,
            policy: "required",
            run: () => extractCompanyDNA({ companyId: args.companyId, prompt: userPrompt, identity }),
            report: result => {
                const diffs = result.dna.keyDifferentiators;
                return {
                    detail: `Found ${diffs.length} differentiator${diffs.length !== 1 ? "s" : ""} (source: ${result.debug.source})`,
                    data: {
                        source: result.debug.source,
                        coreMission: result.dna.coreMission,
                        keyDifferentiators: result.dna.keyDifferentiators,
                        provenResults: result.dna.provenResults,
                        technicalEdge: result.dna.technicalEdge,
                    },
                    narration: `Analyzing company DNA... Core mission: "${result.dna.coreMission}". Identified ${diffs.length} key differentiator${diffs.length !== 1 ? "s" : ""}: ${diffs.join("; ")}. Technical edge: "${result.dna.technicalEdge}".`,
                };
            },
        }),
        stage({
            id: "analyzing-competitors",
            parallelGroup: PG_GATHER,
            policy: "required",
            run: () => analyzeCompetitors({ companyName, categories, companyContext: companyIdentity }),
            report: result => {
                const compCount = result.competitors.length;
                const compNames = result.competitors.map(c => c.name).join(", ");
                return {
                    detail: `Identified ${compCount} competitor${compCount !== 1 ? "s" : ""}`,
                    data: {
                        competitors: result.competitors.map(c => ({
                            name: c.name,
                            positioning: c.positioning,
                        })),
                        ourAdvantages: result.ourAdvantages,
                        marketGaps: result.marketGaps,
                    },
                    narration: `Scanning the competitive landscape... Found ${compCount} competitor${compCount !== 1 ? "s" : ""}: ${compNames || "none identified"}. Key advantages we have: ${result.ourAdvantages.join("; ") || "none yet"}. Market gaps to exploit: ${result.marketGaps.join("; ") || "none identified"}.`,
                };
            },
        }),
        stage({
            id: "researching-trends",
            parallelGroup: PG_GATHER,
            policy: "degradable",
            fallback: {
                value: [],
                detail: "Trend search unavailable — continuing without trends",
                narration: "Trend search unavailable — continuing without trends. The content will rely on company DNA and competitor insights instead.",
                logMessage: `${LOG_PREFIX} trend research failed:`,
            },
            run: async () => {
                const platformGuidelines = getPlatformProfile(normalizedInput.platform).guidelines(normalizedInput.platformMeta);
                const basicContext = [
                    companyIdentity,
                    "",
                    "Platform best practices:",
                    platformGuidelines,
                ].join("\n");
                const raw = await researchPlatformTrends({
                    platform: normalizedInput.platform,
                    prompt: userPrompt,
                    companyName,
                    companyContext: basicContext,
                    companyIndustry,
                    maxResults: normalizedInput.maxResearchResults ?? 6,
                });
                return normalizeResearch(raw);
            },
            report: normalized => {
                const topicTitles = normalized
                    .slice(0, 4)
                    .map(r => r.title)
                    .join("; ");
                return {
                    detail: `Discovered ${normalized.length} trending topic${normalized.length !== 1 ? "s" : ""}`,
                    data: {
                        topics: normalized.slice(0, 4).map(r => ({ title: r.title, url: r.url })),
                    },
                    narration: `Researching what's trending on ${normalizedInput.platform}... Found ${normalized.length} relevant topic${normalized.length !== 1 ? "s" : ""}: ${topicTitles || "none"}. These will frame the narrative hooks.`,
                };
            },
        }),
        stage({
            id: "extracting-voice",
            parallelGroup: PG_GATHER,
            policy: "degradable",
            fallback: {
                value: undefined,
                detail: "Using default voice",
                narration: "Brand voice extraction failed — using a balanced default voice for content generation.",
                logMessage: `${LOG_PREFIX} brand voice extraction failed:`,
            },
            run: () => extractBrandVoice({
                companyId: args.companyId,
                toneOverride: normalizedInput.toneOverride,
            }),
            report: voice => ({
                detail: `Tone: ${voice.toneDescriptor}`,
                data: {
                    tone: voice.toneDescriptor,
                    formality: voice.formalityLevel,
                    style: voice.sentenceStyle,
                    vocabulary: voice.vocabularyExamples,
                },
                narration: `Detecting brand voice from existing content... Tone: ${voice.toneDescriptor}. Formality: ${voice.formalityLevel}. Writing style: ${voice.sentenceStyle}.`,
            }),
        }),
        stage({
            id: "extracting-persona",
            parallelGroup: PG_GATHER,
            policy: "degradable",
            skip: {
                when: !normalizedInput.targetAudience,
                value: undefined,
                detail: "No target audience specified",
                narration: "Skipping persona — no target audience specified. Content will be written for a general professional audience.",
            },
            fallback: {
                value: undefined,
                detail: "Persona unavailable",
                narration: "Persona extraction failed — content will target a general audience.",
                logMessage: `${LOG_PREFIX} persona extraction failed:`,
            },
            run: () => extractTargetPersona({
                companyId: args.companyId,
                targetAudience: normalizedInput.targetAudience,
            }),
            report: persona => ({
                detail: `Role: ${persona.role}`,
                data: {
                    role: persona.role,
                    painPoints: persona.painPoints,
                    priorities: persona.priorities,
                    languageStyle: persona.languageStyle,
                },
                narration: `Building target persona for "${normalizedInput.targetAudience}"... Role: ${persona.role}. Their top pain points: ${persona.painPoints.join("; ")}. They want: ${persona.priorities.join("; ")}.`,
            }),
        }),
        stage({
            id: "checking-performance",
            parallelGroup: PG_GATHER,
            policy: "degradable",
            fallback: {
                value: [],
                detail: "No performance data",
                narration: "Could not retrieve performance data — proceeding without historical context.",
                logMessage: `${LOG_PREFIX} performance check failed:`,
            },
            run: async () => {
                const history = await getPerformanceHistory({
                    companyId: args.companyId,
                    platform: normalizedInput.platform,
                });
                return buildPerformanceInsights(history);
            },
            report: insights => insights.length > 0
                ? {
                    detail: `${insights.length} insight${insights.length !== 1 ? "s" : ""}`,
                    data: { insights },
                    narration: `Reviewing past campaign performance... Found ${insights.length} insight${insights.length !== 1 ? "s" : ""}: ${insights.slice(0, 3).join("; ")}. These will inform the strategy.`,
                }
                : {
                    status: "skipped",
                    detail: "No history yet",
                    narration: "No past performance history yet — this is the first campaign for this platform. Will use general best practices.",
                },
        }),
    ]);
    const { dna, debug: dnaDebug } = dnaResult;
    // 3) Build 3 messaging strategy variants from DNA + competitors + trends + voice + persona
    const trendsSummary = formatTrendsSummary(research);
    const strategies = await stage({
        id: "building-strategy",
        policy: "required",
        run: () => buildMultiStrategy({
            dna,
            competitors,
            trendsSummary,
            userPrompt,
            brandVoice,
            targetPersona,
            performanceInsights,
        }),
        report: built => ({
            detail: `Built ${built.length} strategy variants`,
            data: {
                strategies: built.map(s => ({
                    variantId: s.variantId,
                    angle: s.angle,
                    angleRationale: s.angleRationale,
                    keyProof: s.keyProof,
                })),
            },
            narration: `Crafting ${built.length} positioning strateg${built.length !== 1 ? "ies" : "y"}...\n${built.map((s, i) => `  ${i + 1}. ${s.angle} — ${s.angleRationale}`).join("\n")}`,
        }),
    });
    // 4) Generate content variants (one per strategy) in parallel
    const platformGuidelines = getPlatformProfile(normalizedInput.platform).guidelines(normalizedInput.platformMeta);
    const companyContext = `${companyContextBase}\n\nPlatform best practices:\n${platformGuidelines}`;
    const generation = await stage({
        id: "generating-content",
        policy: "required",
        run: async () => {
            const variants = await generateVariants({
                platform: normalizedInput.platform,
                prompt: userPrompt,
                companyContext,
                research,
                strategies,
                enableQualityGate: false,
                platformMeta: normalizedInput.platformMeta ?? undefined,
                brandVoice,
                targetPersona,
                contentType: normalizedInput.contentType,
            });
            // Opt-in ranking (P2): score each variant and pick the best. A
            // ranking failure degrades to the pre-ranking selection.
            let ranking = null;
            if (normalizedInput.enableVariantRanking && variants.length > 1) {
                try {
                    ranking = await rankVariants({
                        posts: variants.map(v => v.message),
                        platform: normalizedInput.platform,
                    });
                }
                catch (err) {
                    console.warn(`${LOG_PREFIX} variant ranking failed:`, err);
                }
            }
            return { variants, ranking };
        },
        report: ({ variants: generated, ranking }) => {
            const rankedNote = ranking
                ? ` Ranked by quality score — best: ${generated[ranking.bestIndex]?.variantId} (${ranking.scores.find(s => s.index === ranking.bestIndex)?.score ?? "?"}/10).`
                : "";
            return {
                detail: `Generated ${generated.length} variant${generated.length !== 1 ? "s" : ""}: ${generated.map(v => v.variantId).join(", ")}`,
                data: {
                    variants: generated.map(v => ({
                        variantId: v.variantId,
                        angleRationale: v.angleRationale,
                        charCount: v.message.length,
                        mediaType: v.mediaType,
                    })),
                    ...(ranking
                        ? {
                            ranking: ranking.scores.map(sc => ({
                                variantId: generated[sc.index]?.variantId,
                                score: sc.score,
                                issues: sc.issues,
                            })),
                            bestVariantId: generated[ranking.bestIndex]?.variantId,
                        }
                        : {}),
                },
                narration: `Writing ${generated.length} content variant${generated.length !== 1 ? "s" : ""} in parallel, one per strategy angle — each tailored to ${normalizedInput.platform} conventions. Results: ${generated.map(v => `${v.variantId} (${v.message.length} chars, ${v.mediaType})`).join("; ")}.${rankedNote}`,
            };
        },
    });
    const variants = generation.variants;
    // Pick the primary message: ranking's choice when enabled, else the first
    // surviving variant (the pre-ranking behavior).
    const bestVariant = (generation.ranking
        ? variants[generation.ranking.bestIndex]
        : variants[0]) ?? { message: "", mediaType: "image" };
    const primaryStrategy = strategies.find(s => "variantId" in bestVariant && s.variantId === bestVariant.variantId) ??
        strategies[0];
    // 5) Look up knowledge-base sources for the best variant's claims
    const checked = await stage({
        id: "verifying-claims",
        policy: "degradable",
        fallback: {
            value: { claims: [], totalClaimsFound: 0 },
            detail: "Claim source lookup unavailable",
            narration: "Claim source lookup unavailable — could not cross-reference claims with the knowledge base. Manual review recommended.",
            logMessage: `${LOG_PREFIX} claim source lookup failed:`,
        },
        run: () => checkClaimSources({ companyId: args.companyId, message: bestVariant.message }),
        report: result => {
            const sourced = result.claims.filter(c => c.match !== null).length;
            const truncationNote = result.totalClaimsFound > result.claims.length
                ? ` (checked ${result.claims.length} of ${result.totalClaimsFound} found)`
                : "";
            return {
                detail: `${result.claims.length} claim${result.claims.length !== 1 ? "s" : ""}, ${sourced} sourced${truncationNote}`,
                data: {
                    claims: result.claims.map(c => ({
                        claim: c.claim.slice(0, 100),
                        sourceDoc: c.match?.sourceDoc ?? null,
                        relevance: c.match?.relevance != null ? Math.round(c.match.relevance * 100) : null,
                    })),
                },
                narration: `Cross-referencing claims against the knowledge base... ${sourced}/${result.claims.length} claim${result.claims.length !== 1 ? "s" : ""} have a matching source. ${sourced === result.claims.length ? "Every claim has a source." : "Some claims lack a matching source — review recommended."}`,
            };
        },
    });
    const claimSources = checked.claims;
    // 6) Save to performance history (fire & forget)
    void saveGeneratedContent({
        companyId: args.companyId,
        platform: normalizedInput.platform,
        message: bestVariant.message,
        angle: primaryStrategy?.angle,
        contentType: normalizedInput.contentType ?? "post",
    }).catch(err => console.warn(`${LOG_PREFIX} save history failed:`, err));
    const totalMs = Date.now() - pipelineStart;
    console.log(`${LOG_PREFIX} total pipeline completed in %dms`, totalMs);
    return {
        platform: normalizedInput.platform,
        message: bestVariant.message,
        "image/video": bestVariant.mediaType,
        research,
        normalizedInput: {
            platform: normalizedInput.platform,
            prompt: userPrompt,
        },
        competitiveAngle: primaryStrategy?.angle,
        strategyUsed: primaryStrategy
            ? {
                angle: primaryStrategy.angle,
                keyProof: primaryStrategy.keyProof,
                humanHook: primaryStrategy.humanHook,
                avoidList: primaryStrategy.avoidList,
            }
            : undefined,
        ...(args.debug ? { dnaDebug } : {}),
        variants,
        pipelineStages: {
            dna,
            competitors,
            trends: research,
            strategies,
            brandVoice,
            targetPersona,
            performanceInsights,
            // The exact knowledge context the generator used, so evaluation scores
            // groundedness against the same facts (not a re-derived context).
            companyContext: companyContextBase,
        },
        claimSources,
    };
}
//# sourceMappingURL=run.js.map