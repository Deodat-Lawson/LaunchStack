"use client";

/**
 * Models & usage › Models.
 *
 * For someone who manages the workspace's models (`models.manage`):
 * - **In Ask's model menu**: Standard and Fast, which every workspace has,
 *   then the models the workspace offers beside them. An admin adds those
 *   from the workspace's own API key and names each one; everyone sees the
 *   name, never the provider's id (`OfferedModelsEditor`).
 * - **Usage by model**: each model's chat use in the tab's window — the
 *   workspace's own models by id and name, the server's by route only.
 * - **Server default**: what the server runs workspaces on that brought no
 *   key (the `models` settings section).
 *
 * For everyone else: what they can pick in Ask's model menu, read-only.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { PageHeader } from "~/components/tools/PageHeader";
import { Badge } from "~/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import type { UsageModelRow, UsageModels } from "~/lib/usage/types";

import { ModelsSection } from "../settings/ModelsSection";
import { StatusNote } from "../settings/ui";
import {
    WORKSPACE_ENDPOINT_URL,
    type WorkspaceEndpointView,
} from "../settings/WorkspaceModelPanel";
import { EmptyLine, LoadingRows, Panel } from "../team/ui";
import { useUsageFilters, useUsageLoad, windowQuery } from "./data";
import { useUsageFormat } from "./format";
import { OfferedModelsEditor } from "./OfferedModelsEditor";
import { LoadFailed, WindowBar, useWindowLabel } from "./ui";

/** Where API keys lives inside the tab. */
const KEYS_PATH = "/keys";

export function ModelsScreen({ manage }: { manage: boolean }) {
    return manage ? <ManageModels /> : <PickableModels />;
}

// ---------------------------------------------------------------------------
// Managing
// ---------------------------------------------------------------------------

function ManageModels() {
    const t = useTranslations("usage.models");
    const { choice } = useUsageFilters();
    const query = useMemo(() => windowQuery(choice), [choice]);
    const usage = useUsageLoad<UsageModels>("/api/usage/models", query);
    const range = useWindowLabel(usage.data?.window);

    const [endpoint, setEndpoint] = useState<WorkspaceEndpointView | null>(null);
    const [endpointState, setEndpointState] = useState<"loading" | "ready" | number>("loading");
    const readEndpoint = useCallback(async () => {
        try {
            const res = await fetch(WORKSPACE_ENDPOINT_URL, { cache: "no-store" });
            if (!res.ok) {
                setEndpointState(res.status);
                return;
            }
            const body = (await res.json()) as { endpoint?: WorkspaceEndpointView | null };
            setEndpoint(body.endpoint ?? null);
            setEndpointState("ready");
        } catch {
            setEndpointState(0);
        }
    }, []);
    useEffect(() => {
        void readEndpoint();
    }, [readEndpoint]);

    return (
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5" data-testid="usage-models">
            <PageHeader
                title={t("title")}
                sub={usage.data ? t("sub", { range }) : " "}
                actions={<WindowBar />}
            />

            <Panel title={t("menu.title")} testId="usage-models-menu">
                {endpointState === "loading" ? (
                    <LoadingRows rows={3} />
                ) : typeof endpointState === "number" ? (
                    <div className="px-3.5 py-2">
                        <LoadFailed status={endpointState} onRetry={() => void readEndpoint()} />
                    </div>
                ) : (
                    <div className="flex flex-col gap-3 px-3.5 pb-3.5 pt-1">
                        <p className="text-ink-3 m-0 text-[12.5px] leading-relaxed">
                            {t("menu.intro")}
                        </p>
                        <TierRows endpoint={endpoint} />
                        {endpoint?.active ? (
                            <OfferedModelsEditor
                                endpoint={endpoint}
                                onSaved={next => {
                                    setEndpoint(next);
                                    usage.reload();
                                }}
                            />
                        ) : (
                            <div className="border-line bg-panel-2 flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-3">
                                <p className="text-ink-2 m-0 min-w-0 flex-1 text-[13px]">
                                    {endpoint ? t("menu.chooseMainFirst") : t("menu.connectFirst")}
                                </p>
                                <ToolLink
                                    href={KEYS_PATH}
                                    className="text-brand-ink text-[12.5px] font-medium hover:underline"
                                >
                                    {t("menu.openKeys")}
                                </ToolLink>
                            </div>
                        )}
                    </div>
                )}
            </Panel>

            <UsageByModel load={usage} />

            <div data-testid="usage-models-server">
                <ModelsSection />
            </div>
        </div>
    );
}

/** Standard and Fast, as this workspace's key serves them (or the server's, unnamed). */
function TierRows({ endpoint }: { endpoint: WorkspaceEndpointView | null }) {
    const t = useTranslations("usage.models.menu");
    const tRoutes = useTranslations("chat.composer.routes");
    const own = endpoint?.active ? endpoint.models : null;
    const rows = [
        {
            id: "default",
            label: tRoutes("default.label"),
            line: own ? t("ownMain", { id: own.default.id }) : t("serverMain"),
        },
        {
            id: "fast",
            label: tRoutes("fast.label"),
            line: own
                ? own.fast
                    ? t("ownFast", { id: own.fast.id })
                    : t("sameAsMain", { id: own.default.id })
                : t("serverFast"),
        },
    ];
    return (
        <ul className="border-line divide-line m-0 flex list-none flex-col divide-y rounded-lg border p-0">
            {rows.map(row => (
                <li
                    key={row.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5"
                >
                    <span className="text-ink text-[13px] font-semibold">{row.label}</span>
                    <span className="text-ink-3 min-w-0 flex-1 truncate text-[12.5px]">
                        {row.line}
                    </span>
                    <Badge variant="secondary">{t("always")}</Badge>
                </li>
            ))}
        </ul>
    );
}

function UsageByModel({
    load,
}: {
    load: { data: UsageModels | null; loading: boolean; failed: number | null; reload: () => void };
}) {
    const t = useTranslations("usage.models.usage");
    const format = useUsageFormat();
    const rows = load.data?.rows ?? [];
    return (
        <Panel title={t("title")} testId="usage-models-usage">
            {load.failed !== null && !load.data ? (
                <div className="px-3.5 py-2">
                    <LoadFailed status={load.failed} onRetry={load.reload} />
                </div>
            ) : !load.data ? (
                <LoadingRows rows={3} />
            ) : rows.length === 0 ? (
                <EmptyLine>{t("empty")}</EmptyLine>
            ) : (
                <Table className={load.loading ? "text-[12.5px] opacity-60" : "text-[12.5px]"}>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("model")}</TableHead>
                            <TableHead className="text-right">{t("calls")}</TableHead>
                            <TableHead className="@max-md:hidden text-right">
                                {t("input")}
                            </TableHead>
                            <TableHead className="@max-md:hidden text-right">
                                {t("output")}
                            </TableHead>
                            <TableHead className="text-right">{t("usage")}</TableHead>
                            <TableHead className="text-right">{t("cost")}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map(row => (
                            <TableRow key={rowKey(row)} data-testid="usage-models-row">
                                <TableCell className="min-w-0">
                                    <ModelName row={row} />
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {format.num(row.calls)}
                                </TableCell>
                                <TableCell className="@max-md:hidden text-right tabular-nums">
                                    {format.compact(row.inputTokens)}
                                </TableCell>
                                <TableCell className="@max-md:hidden text-right tabular-nums">
                                    {format.compact(row.outputTokens)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {format.compact(row.aiTokens)}
                                </TableCell>
                                <TableCell
                                    className="text-right tabular-nums"
                                    title={
                                        row.costUsd !== null && row.pricedCalls < row.calls
                                            ? t("partlyPriced", {
                                                  priced: format.num(row.pricedCalls),
                                                  calls: format.num(row.calls),
                                              })
                                            : undefined
                                    }
                                >
                                    {format.usd(row.costUsd)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </Panel>
    );
}

const rowKey = (row: UsageModelRow) =>
    row.kind === "workspace" ? `w:${row.modelId}` : `s:${row.route}`;

function ModelName({ row }: { row: UsageModelRow }) {
    const t = useTranslations("usage.models.usage");
    const format = useUsageFormat();
    if (row.kind === "server") {
        return (
            <div className="flex min-w-0 flex-col">
                <span className="text-ink">{format.route(row.route ?? "")}</span>
                <span className="text-ink-3 text-[11.5px]">{t("serverDefault")}</span>
            </div>
        );
    }
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-ink truncate">{row.label ?? row.modelId}</span>
            <span className="flex flex-wrap items-center gap-1">
                {row.label && (
                    <span className="text-ink-3 max-w-full truncate font-mono text-[11px]">
                        {row.modelId}
                    </span>
                )}
                {row.key && <Badge variant="info">{t("inAsk")}</Badge>}
                {(row.routes ?? []).map(route => (
                    <Badge key={route} variant="secondary">
                        {format.route(route)}
                    </Badge>
                ))}
                {row.retired && <Badge variant="warn">{t("retired")}</Badge>}
            </span>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Read-only: what someone can pick
// ---------------------------------------------------------------------------

interface PickableModel {
    key: string;
    label: string;
    vision?: { supported: boolean };
    reasoning?: { mode: string };
}

interface PublicConfig {
    routes: Record<string, { available: boolean }>;
    models?: PickableModel[];
}

function PickableModels() {
    const t = useTranslations("usage.models");
    const tRoutes = useTranslations("chat.composer.routes");
    const config = useUsageLoad<PublicConfig>("/api/config/ai-models");
    const offered = config.data?.models ?? [];

    return (
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5" data-testid="usage-models">
            <PageHeader title={t("title")} sub={t("subSelf")} />
            <Panel title={t("menu.title")} testId="usage-models-menu">
                {config.failed !== null && !config.data ? (
                    <div className="px-3.5 py-2">
                        <LoadFailed status={config.failed} onRetry={config.reload} />
                    </div>
                ) : !config.data ? (
                    <LoadingRows rows={3} />
                ) : (
                    <div className="flex flex-col gap-3 px-3.5 pb-3.5 pt-1">
                        <p className="text-ink-3 m-0 text-[12.5px] leading-relaxed">
                            {t("menu.introSelf")}
                        </p>
                        <ul className="border-line divide-line m-0 flex list-none flex-col divide-y rounded-lg border p-0">
                            {(["default", "fast"] as const).map(route => (
                                <li
                                    key={route}
                                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5"
                                >
                                    <span className="text-ink text-[13px] font-semibold">
                                        {tRoutes(`${route}.label`)}
                                    </span>
                                    <span className="text-ink-3 min-w-0 flex-1 text-[12.5px]">
                                        {tRoutes(`${route}.blurb`)}
                                    </span>
                                    {config.data?.routes[route]?.available === false && (
                                        <Badge variant="warn">{t("menu.unavailable")}</Badge>
                                    )}
                                </li>
                            ))}
                            {offered.map(model => (
                                <li
                                    key={model.key}
                                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5"
                                    data-testid="usage-models-pickable"
                                >
                                    <span className="text-ink text-[13px] font-semibold">
                                        {model.label}
                                    </span>
                                    <span className="text-ink-3 min-w-0 flex-1 text-[12.5px]">
                                        {t("menu.fromWorkspace")}
                                    </span>
                                    {model.vision?.supported && (
                                        <Badge variant="secondary">{t("caps.vision")}</Badge>
                                    )}
                                    {model.reasoning && model.reasoning.mode !== "none" && (
                                        <Badge variant="secondary">{t("caps.reasoning")}</Badge>
                                    )}
                                </li>
                            ))}
                        </ul>
                        {offered.length === 0 && (
                            <StatusNote tone="muted" style={{ marginBottom: 0 }}>
                                {t("menu.noneOfferedSelf")}
                            </StatusNote>
                        )}
                    </div>
                )}
            </Panel>
        </div>
    );
}
