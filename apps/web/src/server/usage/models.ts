/**
 * Models & usage › Models: what each model the workspace runs on used in a
 * window. Chat completions only — embeddings and searches have their own
 * panel on Overview.
 *
 * Whose model a row is decides how it may be named:
 *
 * - The workspace's own key (`owner = workspace`): its admins chose these
 *   models and see their ids on API keys already, so a row carries the id,
 *   the name it is offered under in Ask (when it is), and the routes it
 *   serves.
 * - The deployment's (`owner = deployment`): the screen never names those
 *   models, so their rows are one per route (Standard, Fast, …) and carry no
 *   id at all.
 *
 * The fold is pure so tests can feed it rows; the query is one grouped read
 * of `ai_usage_daily`.
 */

import { and, eq, gte, lte, sql } from "drizzle-orm";

import type { UsageModelRow, UsageModels, UsageWindow } from "~/lib/usage/types";
import { db } from "~/server/db";
import { aiUsageDaily } from "~/server/db/schema";
import type { WorkspaceModelSelection } from "~/server/db/schema/workspace-models";
import { WORKSPACE_MODEL_ROUTES } from "~/server/workspace-models/config";
import { getWorkspaceEndpointRow } from "~/server/workspace-models/store";

/** One group of the window's chat rows. */
export interface ModelUsageRaw {
    owner: string;
    route: string;
    modelId: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    weightedTokens: number;
    pricedCalls: number;
    costUsd: number;
}

type Totals = Pick<
    UsageModelRow,
    "calls" | "inputTokens" | "outputTokens" | "aiTokens" | "pricedCalls"
> & { cost: number };

const empty = (): Totals => ({
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    aiTokens: 0,
    pricedCalls: 0,
    cost: 0,
});

function add(into: Totals, row: ModelUsageRaw): void {
    into.calls += row.calls;
    into.inputTokens += row.inputTokens;
    into.outputTokens += row.outputTokens;
    into.aiTokens += row.weightedTokens;
    into.pricedCalls += row.pricedCalls;
    into.cost += row.costUsd;
}

function finish(totals: Totals): Omit<UsageModelRow, "kind"> {
    const { cost, ...rest } = totals;
    return { ...rest, costUsd: totals.pricedCalls > 0 ? cost : null };
}

/** The deployment's routes in the order the screen lists them; unknown ones go last. */
const ROUTE_ORDER = ["default", "fast", "reasoning", "vision", "auxiliary", ""];
const routeRank = (route: string) => {
    const index = ROUTE_ORDER.indexOf(route);
    return index < 0 ? ROUTE_ORDER.length : index;
};

/**
 * Fold the window's chat rows into one row per workspace model (named from
 * `selection`, the workspace's current setup) and one per deployment route.
 * Busiest first within each owner; the workspace's own models first.
 */
export function modelUsageRows(
    raw: readonly ModelUsageRaw[],
    selection: WorkspaceModelSelection | null
): UsageModelRow[] {
    const own = new Map<string, Totals>();
    const server = new Map<string, Totals>();
    for (const row of raw) {
        if (row.owner === "workspace") {
            const totals = own.get(row.modelId) ?? empty();
            add(totals, row);
            own.set(row.modelId, totals);
        } else {
            const totals = server.get(row.route) ?? empty();
            add(totals, row);
            server.set(row.route, totals);
        }
    }

    const offered = new Map<string, { key: string; label: string }>();
    for (const model of selection?.offered ?? []) {
        if (!offered.has(model.id)) offered.set(model.id, { key: model.key, label: model.label });
    }
    const routesOf = (modelId: string) =>
        selection
            ? WORKSPACE_MODEL_ROUTES.filter(route => selection[route]?.id.trim() === modelId)
            : [];

    const ownRows: UsageModelRow[] = [...own.entries()].map(([modelId, totals]) => {
        const named = offered.get(modelId);
        const routes = routesOf(modelId);
        return {
            kind: "workspace",
            modelId,
            ...(named ? { key: named.key, label: named.label } : {}),
            routes,
            // Used in the window, but neither offered nor on a route now.
            retired: !named && routes.length === 0,
            ...finish(totals),
        };
    });
    ownRows.sort((a, b) => b.aiTokens - a.aiTokens || a.modelId!.localeCompare(b.modelId!));

    const serverRows: UsageModelRow[] = [...server.entries()]
        .map(([route, totals]) => ({ kind: "server" as const, route, ...finish(totals) }))
        .sort((a, b) => routeRank(a.route) - routeRank(b.route));

    return [...ownRows, ...serverRows];
}

/** The window's chat rows, grouped by whose model, route and model id. */
export async function modelUsageRaw(
    companyId: bigint,
    window: Pick<UsageWindow, "from" | "to">
): Promise<ModelUsageRaw[]> {
    const rows = await db
        .select({
            owner: aiUsageDaily.owner,
            route: aiUsageDaily.route,
            modelId: aiUsageDaily.modelId,
            calls: sql<number>`sum(${aiUsageDaily.calls})`,
            inputTokens: sql<number>`sum(${aiUsageDaily.inputTokens})`,
            outputTokens: sql<number>`sum(${aiUsageDaily.outputTokens})`,
            weightedTokens: sql<number>`sum(${aiUsageDaily.weightedTokens})`,
            pricedCalls: sql<number>`sum(${aiUsageDaily.pricedCalls})`,
            costUsd: sql<number>`sum(${aiUsageDaily.costUsd})`,
        })
        .from(aiUsageDaily)
        .where(
            and(
                eq(aiUsageDaily.companyId, companyId),
                eq(aiUsageDaily.kind, "chat"),
                gte(aiUsageDaily.date, window.from),
                lte(aiUsageDaily.date, window.to)
            )
        )
        .groupBy(aiUsageDaily.owner, aiUsageDaily.route, aiUsageDaily.modelId);
    // Sums of bigint and numeric columns come back as strings.
    return rows.map(row => ({
        owner: row.owner,
        route: row.route,
        // A deployment row's model id never leaves this function.
        modelId: row.owner === "workspace" ? row.modelId : "",
        calls: Number(row.calls),
        inputTokens: Number(row.inputTokens),
        outputTokens: Number(row.outputTokens),
        weightedTokens: Number(row.weightedTokens),
        pricedCalls: Number(row.pricedCalls),
        costUsd: Number(row.costUsd),
    }));
}

/** `GET /api/usage/models`. */
export async function usageByModel(companyId: bigint, window: UsageWindow): Promise<UsageModels> {
    const [raw, endpoint] = await Promise.all([
        modelUsageRaw(companyId, window),
        getWorkspaceEndpointRow(companyId),
    ]);
    return { window, rows: modelUsageRows(raw, endpoint?.models ?? null) };
}
