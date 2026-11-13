/**
 * `find_similar_companies` — Prospects' discovery for any MCP client: real
 * companies like the buyers described, in the place named, matched by meaning
 * and checked by the workspace's model. Read-only: nothing is stored.
 */
import { z } from "zod";

import { prospectEmbedder, prospectFitJudge } from "~/server/prospects/matching";
import {
    SIMILAR_LIMITS,
    SimilarCompaniesError,
    findSimilarCompanies,
} from "~/server/prospects/similar";

import { McpToolError, defineTool } from "../protocol";
import { READ_REQUIREMENT, countArgument } from "./shared";

const args = z
    .object({
        offering: z.string().trim().min(3, "describe what you sell").max(1000),
        buyers: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
        place: z.string().trim().min(2).max(200).optional(),
        places: z.array(z.string().trim().min(2).max(200)).max(SIMILAR_LIMITS.places).optional(),
        exclude: z.array(z.string().trim().min(1).max(200)).max(SIMILAR_LIMITS.exclude).optional(),
        seller: z.string().trim().max(1500).optional(),
        depth: z.enum(["quick", "thorough"]).default("thorough"),
        limit: countArgument(1, SIMILAR_LIMITS.results, 10),
    })
    .refine(v => Boolean(v.place) || (v.places?.length ?? 0) > 0, "name a place");

export const findSimilarCompaniesTool = defineTool({
    name: "find_similar_companies",
    title: "Find similar companies nearby",
    description:
        "Find real companies that are likely buyers of what someone sells, in the places they name, the way LaunchStack Prospects does. " +
        "Sources: local businesses from OpenStreetMap (and Exa's company index when configured). Each company's own words are matched to the description by meaning; " +
        "in thorough mode (the default) each shortlisted homepage is read for what it says and for its pictures; then a model checks every one " +
        "and rejects those that would not buy it, are competitors of the seller described, match an exclusion, or are elsewhere. " +
        "Use it for prospecting and lookalike lists: offering 'single-origin coffee beans, wholesale', buyers ['cafés', 'specialty grocers'], places ['Baltimore, MD', 'Washington, DC']. " +
        "Answers within about a minute (it shortens later steps to fit, and says so in warnings); returns up to 25 companies; nothing is saved to the workspace. " +
        'Returns {"places":[{asked,country,region,label}],"unknownPlaces":[],"placesWithoutResults":[],"warnings":[],"matching","depth","leftOut":[{name,website,reason}],"companies":[{name,website,address,country,region,categories,description,imageUrl,iconUrl,relevance,reason,place,source}]}, best first.',
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
            places: {
                type: "array",
                minItems: 1,
                maxItems: 5,
                items: { type: "string", minLength: 2, maxLength: 200 },
                description:
                    "Where, as people write it, searched together: ['Baltimore, MD', 'Amsterdam', 'Germany'].",
            },
            place: {
                type: "string",
                minLength: 2,
                maxLength: 200,
                description: "One place, when there is only one (same as places: [place]).",
            },
            exclude: {
                type: "array",
                maxItems: 20,
                items: { type: "string", minLength: 1, maxLength: 200 },
                description:
                    "Domains to leave out ('acme.com', existing customers) or kinds of business not wanted ('other roasters', 'chains').",
            },
            seller: {
                type: "string",
                maxLength: 1500,
                description:
                    "Who is selling, so competitors are told from buyers, e.g. 'Small-batch roaster in Baltimore selling wholesale to cafés'.",
            },
            depth: {
                type: "string",
                enum: ["quick", "thorough"],
                default: "thorough",
                description:
                    "thorough (default) reads each shortlisted homepage before judging and returns pictures; quick judges on listings alone and is faster.",
            },
            limit: {
                type: "integer",
                minimum: 1,
                maximum: 25,
                default: 10,
                description: "How many companies to return (1-25, default 10).",
            },
        },
        required: ["offering"],
        additionalProperties: false,
    },
    outputSchema: {
        type: "object",
        properties: {
            places: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        asked: { type: "string" },
                        country: { type: "string" },
                        region: { type: ["string", "null"] },
                        label: { type: "string" },
                    },
                    required: ["asked", "country", "label"],
                },
            },
            unknownPlaces: { type: "array", items: { type: "string" } },
            placesWithoutResults: { type: "array", items: { type: "string" } },
            warnings: { type: "array", items: { type: "string" } },
            matching: { type: "string", enum: ["semantic", "lexical"] },
            depth: { type: "string", enum: ["quick", "thorough"] },
            leftOut: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        website: { type: ["string", "null"] },
                        reason: { type: "string" },
                    },
                    required: ["name", "reason"],
                },
            },
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
                        description: { type: ["string", "null"] },
                        imageUrl: { type: ["string", "null"] },
                        iconUrl: { type: ["string", "null"] },
                        relevance: { type: "number" },
                        reason: { type: ["string", "null"] },
                        place: { type: "string" },
                        source: { type: "string", enum: ["openstreetmap", "exa"] },
                    },
                    required: ["name", "website", "relevance", "place", "source"],
                },
            },
        },
        required: ["places", "matching", "depth", "companies"],
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
    async run({ offering, buyers, place, places, exclude, seller, depth, limit }, { principal }) {
        const companyId = principal.ctx.companyId;
        try {
            const result = await findSimilarCompanies(
                {
                    offering,
                    buyers,
                    places: [...(places ?? []), ...(place ? [place] : [])],
                    exclude,
                    seller,
                    depth,
                    limit,
                },
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
