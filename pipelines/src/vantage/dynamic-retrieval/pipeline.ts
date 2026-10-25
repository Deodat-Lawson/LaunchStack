import { runContextV0Pipeline } from "../context-v0/adapters";
import {
    ContextPortErrorV0,
    type ContextAssemblyInputV0,
    type ContextPipelineInputV0,
    type ContextPipelinePortsV0,
} from "../context-v0/ports";
import {
    contextSourceKeyV0 as key,
    type PublicCitationV0,
    type PublicSafeQueryProjectionV0,
    type RequiredContextBundleV0,
} from "../proposals/context-v0";
import { createDynamicRetrievalProviderV0, type DynamicRetrievalOptionsV0 } from "./retrieve";
import {
    createContextResearchPlannerV0,
    createContextResearchProviderV0,
    type ContextResearchToolsV0,
    type ResearchQuestionV0,
} from "./research";
import { tokenCeiling } from "./bounds";

/** Per-run composition: the TL keeps ownership of auth, sources, assembly and persistence. */
export async function runDynamicContextV0(
    input: ContextPipelineInputV0,
    ports: Pick<ContextPipelinePortsV0, "server" | "roles" | "assembler">,
    options: {
        retrieval?: DynamicRetrievalOptionsV0;
        research?: {
            questions: readonly ResearchQuestionV0[];
            approvedPublicQueries?: readonly PublicSafeQueryProjectionV0[];
            publicCitations?: readonly PublicCitationV0[];
            tools?: ContextResearchToolsV0;
        };
    } = {}
) {
    const started = performance.now();
    let queries = 0;
    let required: RequiredContextBundleV0 | undefined;
    let prepared: ContextAssemblyInputV0 | undefined;
    const planner = options.research ? createContextResearchPlannerV0(options.research) : undefined;
    return runContextV0Pipeline(input, {
        ...ports,
        roles: {
            resolveBusinessRoles: request => ports.roles.resolveBusinessRoles(request),
            async resolveRequiredContext(request) {
                required = await ports.roles.resolveRequiredContext(request);
                return required;
            },
        },
        retrieval: {
            async retrieve(retrievalInput) {
                if (!required)
                    throw new ContextPortErrorV0("Retrieval has no required context.", 409);
                const requiredSources = [
                    ...new Map(
                        [
                            required.companyArchitecture,
                            ...required.workspaceMandatoryDocuments,
                            ...required.personalVantageStars,
                        ].map(entry => [key(entry.source), entry])
                    ).values(),
                ];
                const reserved = new Set(requiredSources.map(entry => key(entry.source)));
                const provider = createDynamicRetrievalProviderV0({
                    ...options.retrieval,
                    signal: input.signal,
                    metadata: options.retrieval?.metadata?.filter(
                        item => !reserved.has(key(item.source))
                    ),
                });
                const chars = requiredSources.reduce((n, entry) => n + entry.excerpt.length, 0);
                const tokens = requiredSources.reduce(
                    (n, entry) => n + tokenCeiling(entry.excerpt),
                    0
                );
                if (
                    requiredSources.length > input.budgets.maxSources ||
                    chars > input.budgets.maxExcerptChars ||
                    tokens > input.budgets.maxTokens
                )
                    throw new ContextPortErrorV0(
                        "Required context exceeds the context budget.",
                        409
                    );
                const result = await provider.retrieve({
                    ...retrievalInput,
                    sourceCatalog: retrievalInput.sourceCatalog.filter(
                        entry => !reserved.has(key(entry.source))
                    ),
                    budgets: {
                        ...retrievalInput.budgets,
                        maxSources: input.budgets.maxSources - requiredSources.length,
                        maxExcerptChars: input.budgets.maxExcerptChars - chars,
                        maxTokens: input.budgets.maxTokens - tokens,
                        timeoutMs: Math.max(
                            0,
                            Math.floor(input.budgets.timeoutMs - (performance.now() - started))
                        ),
                    },
                });
                queries = result.diagnostics.queries;
                return result;
            },
        },
        trustedPublicProjections: options.research?.approvedPublicQueries,
        planResearch: planner
            ? context => {
                  prepared = context;
                  const plan = planner(context);
                  const entries = [
                      ...new Map(
                          [
                              context.requiredContext.companyArchitecture,
                              ...context.requiredContext.workspaceMandatoryDocuments,
                              ...context.requiredContext.personalVantageStars,
                              ...context.retrieval.sourceRegistry,
                          ].map(entry => [key(entry.source), entry])
                      ).values(),
                  ];
                  plan.budgets = {
                      maxQueries: Math.max(0, input.budgets.maxQueries - queries),
                      maxSources: Math.max(0, input.budgets.maxSources - entries.length),
                      maxExcerptChars: Math.max(
                          0,
                          input.budgets.maxExcerptChars -
                              entries.reduce((n, e) => n + e.excerpt.length, 0)
                      ),
                      maxTokens: Math.max(
                          0,
                          input.budgets.maxTokens -
                              entries.reduce((n, e) => n + tokenCeiling(e.excerpt), 0)
                      ),
                      timeoutMs: Math.max(
                          0,
                          Math.floor(input.budgets.timeoutMs - (performance.now() - started))
                      ),
                  };
                  if (Object.values(plan.budgets).some(value => value === 0))
                      return {
                          ...plan,
                          mode: "STOP",
                          gapPurpose: "No optional research budget remains.",
                          internalSourceRefs: [],
                          publicSafeQueryProjection: [],
                      };
                  plan.publicSafeQueryProjection = plan.publicSafeQueryProjection.slice(
                      0,
                      plan.budgets.maxQueries
                  );
                  plan.internalSourceRefs = plan.internalSourceRefs.slice(
                      0,
                      Math.min(plan.budgets.maxSources, plan.budgets.maxQueries)
                  );
                  return plan;
              }
            : undefined,
        research: {
            async research(plan) {
                if (!prepared?.retrievalInput)
                    throw new ContextPortErrorV0("Research has no prepared context.", 409);
                return createContextResearchProviderV0({
                    actor: prepared.retrievalInput.actor,
                    asOf: input.reportWindow.asOf,
                    catalog: prepared.retrievalInput.sourceCatalog,
                    approvedPublicQueries: options.research?.approvedPublicQueries,
                    publicCitations: options.research?.publicCitations,
                    tools: options.research?.tools,
                    signal: input.signal,
                }).research(plan);
            },
        },
    });
}
