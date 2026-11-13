/**
 * `find_similar_companies` — Prospects' discovery for any MCP client: real
 * companies like the buyers described, in the place named, matched by meaning
 * and checked by the workspace's model. Read-only: nothing is stored.
 */
import { z } from "zod";

import { prospectEmbedder, prospectFitJudge } from "~/server/prospects/matching";
import { SimilarCompaniesError, findSimilarCompanies } from "~/server/prospects/similar";

import { McpToolError, defineTool } from "../protocol";
import { READ_REQUIREMENT, countArgument } from "./shared";

const args = z.object({
    offering: z.string().trim().min(3, "describe what you sell").max(1000),
    buyers: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
    place: z.string().trim().min(2, "name a place").max(200),
    limit: countArgument(1, 15, 8),
});

export const findSimilarCompaniesTool = defineTool({
    name: "find_similar_companies",
    title: "Find similar companies nearby",
    description:
        "Find real companies in a place that are likely buyers of what someone sells, the way LaunchStack Prospects does: " +
        "local businesses from OpenStreetMap (and Exa's company index when configured), matched to the description by meaning " +
        "and checked by a model that rejects ones that would not buy it or are elsewhere. " +
        "Use it for prospecting and lookalike searches: 'specialty coffee roaster selling to cafés in Baltimore, MD'. " +
        "It takes tens of seconds and returns at most 15 companies; nothing is saved to the workspace. " +
        'Returns {"place":{country,region,label},"matching":"semantic"|"lexical","companies":[{name,website,address,country,region,categories,relevance,reason,source}]}, best first.',
    inputSchema: {
        type: "object",
        properties: {
            offering: {
                type: "string",
                minLength: 3,
                maxLength: 1000,
                description:
                    "What the seller sells, in plain words, e.g. 'single-origin roasted coffee beans, sold wholesale'.",
            },
            buyers: {
                type: "array",
                maxItems: 8,
                items: { type: "string", minLength: 1, maxLength: 120 },
                description: "Kinds of business that buy it, e.g. ['cafés', 'specialty grocers'].",
            },
            place: {
                type: "string",
                minLength: 2,
                maxLength: 200,
                description: "Where, as people write it: 'Baltimore, MD', 'Amsterdam', 'Germany'.",
            },
            limit: {
                type: "integer",
                minimum: 1,
                maximum: 15,
                default: 8,
                description: "How many companies to return (1-15, default 8).",
            },
        },
        required: ["offering", "place"],
        additionalProperties: false,
    },
    outputSchema: {
        type: "object",
        properties: {
            place: {
                type: "object",
                properties: {
                    country: { type: "string" },
                    region: { type: ["string", "null"] },
                    label: { type: "string" },
                },
                required: ["country", "region", "label"],
            },
            matching: { type: "string", enum: ["semantic", "lexical"] },
            companies: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        website: { type: ["string", "null"] },
                        address: { type: ["string", "null"] },
                        country: { type: ["string", "null"] },
                        region: { type: ["string", "null"] },
                        categories: { type: "array", items: { type: "string" } },
                        relevance: { type: "number" },
                        reason: { type: ["string", "null"] },
                        source: { type: "string", enum: ["openstreetmap", "exa"] },
                    },
                    required: ["name", "website", "relevance", "source"],
                },
            },
        },
        required: ["place", "matching", "companies"],
    },
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        // Reads public maps, company indexes and websites outside the workspace.
        openWorldHint: true,
    },
    requires: READ_REQUIREMENT,
    // Each call reads public sources and spends the workspace's model and embedding quota.
    rateLimit: { maxRequests: 20, windowMs: 60 * 60 * 1000 },
    args,
    async run({ offering, buyers, place, limit }, { principal }) {
        const companyId = principal.ctx.companyId;
        try {
            const result = await findSimilarCompanies(
                { offering, buyers, place, limit },
                {
                    embed: await prospectEmbedder(companyId),
                    judgeFit: await prospectFitJudge(companyId),
                }
            );
            return {
                ok: true,
                text: JSON.stringify(result),
                structured: { ...result },
            };
        } catch (error) {
            if (error instanceof SimilarCompaniesError) throw new McpToolError(error.message);
            throw error;
        }
    },
});
