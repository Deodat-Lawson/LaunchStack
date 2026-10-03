/**
 * Everything the grants stages need from outside, as ports. Production
 * wiring lives in `createDefaultPorts`; tests and fixtures hand in their own.
 * Publishing an export into Sources and metering stay host concerns: the
 * web app passes those in.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessageLike } from "@langchain/core/messages";
import { eq } from "drizzle-orm";
import type { z } from "zod";

import { invokeStructured, resolveChatModel, type ResolveChatModelOptions } from "@launchstack/llm";
import type { DocumentScope, RagSearchResult } from "@launchstack/retrieval";
import { getDb } from "@launchstack/store/client";
import {
    formatMetadataContext,
    getCompanyIdentity,
    type CompanyIdentity,
} from "@launchstack/tools/company-context";
import { companyMetadata } from "@launchstack/tools/company-context/schema";
import {
    findGrants,
    type GrantSearchQuery,
    type GrantSearchResult,
} from "@launchstack/tools/grant-search";
import { retrieveCompanySnippets, type SnippetPolicy } from "@launchstack/tools/grounded-retrieval";
import { fetchReadable } from "@launchstack/tools/web-research";

/** One model policy per stage; a route or temperature change is an explicit edit here. */
export const PROPOSALS_MODELS = {
    profile: { route: "fast", temperature: 0.2 },
    plan: { route: "fast", temperature: 0.3 },
    score: { route: "fast", temperature: 0.2 },
    extract: { route: "fast", temperature: 0.1 },
    draft: { route: "default", temperature: 0.4 },
    rewrite: { route: "default", temperature: 0.3 },
    review: { route: "default", temperature: 0.2 },
} as const satisfies Record<string, ResolveChatModelOptions>;

export type ProposalStage = keyof typeof PROPOSALS_MODELS;

/** Credits per stage, in the ledger's token units. */
export const PROPOSAL_CREDITS = {
    profile: 3_000,
    funders: 2_000,
    extract: 1_000,
    draft: 1_500,
    rewrite: 1_000,
    review: 2_000,
} as const;

export interface RetrieveArgs {
    companyId: number;
    query: string;
    policy: SnippetPolicy;
    scope?: DocumentScope;
}

export interface ProposalPorts {
    identity(companyId: number): Promise<CompanyIdentity>;
    /** The company-metadata projection as a prompt block; null when none exists. */
    metadataContext(companyId: number): Promise<string | null>;
    retrieve(args: RetrieveArgs): Promise<RagSearchResult[]>;
    structured<T>(
        stage: ProposalStage,
        schema: z.ZodType<T>,
        system: string,
        user: string,
        name: string
    ): Promise<{ result: T; modelId: string }>;
    searchGrants(query: GrantSearchQuery): Promise<GrantSearchResult>;
    /** A funder's page as readable text; null in hosts without egress. */
    fetchPage: ((url: string) => Promise<{ title: string | null; text: string }>) | null;
    /** Host-owned metering; null records nothing. */
    debitCredits:
        | ((args: { amount: number; description: string; referenceId: string }) => Promise<void>)
        | null;
    now(): Date;
}

export interface CreateDefaultPortsOptions {
    debitCredits?: ProposalPorts["debitCredits"];
    /** Set false in hosts that must not fetch arbitrary URLs. */
    enableFetch?: boolean;
}

export function createDefaultPorts(options: CreateDefaultPortsOptions = {}): ProposalPorts {
    return {
        identity: async companyId => (await getCompanyIdentity({ companyId })).data,
        metadataContext: async companyId => {
            const [row] = await getDb()
                .select({ metadata: companyMetadata.metadata })
                .from(companyMetadata)
                .where(eq(companyMetadata.companyId, BigInt(companyId)))
                .limit(1);
            return row?.metadata ? formatMetadataContext(row.metadata) : null;
        },
        retrieve: async ({ companyId, query, policy, scope }) =>
            (
                await retrieveCompanySnippets({
                    companyId,
                    query,
                    policy,
                    scope,
                    onError: "empty",
                })
            ).results,
        structured: async (stage, schema, system, user, name) => {
            const resolved = resolveChatModel(PROPOSALS_MODELS[stage]);
            const messages: BaseMessageLike[] = [new SystemMessage(system), new HumanMessage(user)];
            const result = await invokeStructured(resolved, schema, messages, { name });
            return { result, modelId: resolved.modelId };
        },
        searchGrants: query => findGrants(query),
        fetchPage:
            options.enableFetch === false
                ? null
                : async url => {
                      const page = await fetchReadable(url);
                      return { title: page.title, text: page.text };
                  },
        debitCredits: options.debitCredits ?? null,
        now: () => new Date(),
    };
}
