/**
 * `list_prospects` — the workspace's saved Prospects companies for any MCP
 * client: per segment, with fit, stage, why they fit, location, website and
 * pictures, and a link to each company's page. Read-only.
 */
import { z } from "zod";

import { toolTabHref } from "~/lib/tool-app/locations";
import { betaAppsOn } from "~/server/beta-apps";
import { listCompanies, listSegments, type ProspectsCtx } from "~/server/prospects/service";

import { defineTool } from "../protocol";
import { READ_ONLY_ANNOTATIONS, READ_REQUIREMENT, countArgument } from "./shared";

const args = z.object({
    segment: z.string().trim().max(256).optional(),
    query: z.string().trim().max(200).optional(),
    minFit: z.number().int().min(0).max(100).optional(),
    stage: z
        .enum([
            "lead",
            "qualified",
            "contacted",
            "meeting",
            "proposal",
            "negotiating",
            "won",
            "lost",
            "nurture",
        ])
        .optional(),
    limit: countArgument(1, 100, 25),
});

export const listProspectsTool = defineTool({
    name: "list_prospects",
    title: "List saved prospects",
    description:
        "List the companies saved in the workspace's Growth › Prospects: the segments (who the workspace sells to, and where), " +
        "and for one segment its companies, best fit first, with fit score (0-100), deal stage, why they fit, location, website, pictures and a link to the company's page. " +
        "Use it to bring the workspace's prospect list into another tool, a CRM or a report. Call it without a segment to see the segments. " +
        'Returns {"segments":[{id,name,companies}],"segment":{id,name}|null,"companies":[{id,name,website,location,fit,stage,why,imageUrl,iconUrl,url}]}.',
    inputSchema: {
        type: "object",
        properties: {
            segment: {
                type: "string",
                maxLength: 256,
                description: "A segment's id or name (from segments). Omitted: the first segment.",
            },
            query: {
                type: "string",
                maxLength: 200,
                description: "Only companies whose name matches.",
            },
            minFit: {
                type: "integer",
                minimum: 0,
                maximum: 100,
                description: "Only companies at or above this fit score.",
            },
            stage: {
                type: "string",
                enum: [
                    "lead",
                    "qualified",
                    "contacted",
                    "meeting",
                    "proposal",
                    "negotiating",
                    "won",
                    "lost",
                    "nurture",
                ],
                description: "Only deals at this stage.",
            },
            limit: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 25,
                description: "How many companies to return (1-100, default 25).",
            },
        },
        additionalProperties: false,
    },
    outputSchema: {
        type: "object",
        properties: {
            segments: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        companies: { type: "integer" },
                    },
                    required: ["id", "name", "companies"],
                },
            },
            segment: {
                type: ["object", "null"],
                properties: { id: { type: "string" }, name: { type: "string" } },
            },
            companies: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        website: { type: ["string", "null"] },
                        location: { type: "string" },
                        fit: { type: ["integer", "null"] },
                        stage: { type: "string" },
                        why: { type: "string" },
                        imageUrl: { type: ["string", "null"] },
                        iconUrl: { type: ["string", "null"] },
                        url: { type: "string" },
                    },
                    required: ["id", "name", "location", "stage", "why", "url"],
                },
            },
        },
        required: ["segments", "segment", "companies"],
    },
    annotations: READ_ONLY_ANNOTATIONS,
    requires: READ_REQUIREMENT,
    args,
    async run({ segment, query, minFit, stage, limit }, { principal, origin }) {
        const { companyId, authUserId, userPk } = principal.ctx;
        if (!(await betaAppsOn(companyId)))
            return {
                ok: false,
                message: "Prospects is a beta app, and it is off in this workspace.",
            };
        const ctx: ProspectsCtx = { companyId, userId: authUserId, userPk };
        const segments = await listSegments(ctx);
        const wanted = segment?.toLowerCase();
        const picked = wanted
            ? segments.find(s => s.id === segment || s.name.toLowerCase() === wanted)
            : segments[0];
        if (wanted && !picked)
            return {
                ok: false,
                message: `No segment "${segment}". Call list_prospects without a segment to see them.`,
            };
        const rows = picked
            ? (await listCompanies(ctx, picked.id, { view: "all", q: query ?? "", sort: "fit" }))
                  .companies
            : [];
        const companies = rows
            .filter(c => !c.excluded)
            .filter(c => minFit === undefined || (c.fit ?? 0) >= minFit)
            .filter(c => !stage || c.stage === stage)
            .slice(0, limit)
            .map(c => ({
                id: c.id,
                name: c.name,
                website: c.domain ? `https://${c.domain}` : null,
                location: c.hq,
                fit: c.fit,
                stage: c.stage,
                why: c.why,
                imageUrl: c.imageUrl ?? null,
                iconUrl: c.iconUrl ?? null,
                url: `${origin}${toolTabHref("growth", `/prospects/companies/${encodeURIComponent(c.id)}`)}`,
            }));
        const structured = {
            segments: segments.map(s => ({
                id: s.id,
                name: s.name,
                companies: s.counts.companies,
            })),
            segment: picked ? { id: picked.id, name: picked.name } : null,
            companies,
        };
        return { ok: true, text: JSON.stringify(structured), structured };
    },
});
