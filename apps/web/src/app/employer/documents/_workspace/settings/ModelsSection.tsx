"use client";

/**
 * Settings › Models.
 *
 * Body only. Two parts:
 *
 * - **Your own model** (`WorkspaceModelPanel`): the workspace's own provider
 *   account, connected through OpenRouter or an address and API key. Once a
 *   main model is chosen, everything the workspace runs goes there.
 * - **Server default**: what the server resolved from its chat configuration
 *   file — a table of routes, then a card per configured model saying what it
 *   can do. It never names the vendor, the endpoint, or the model id — the
 *   server doesn't send them (see `~/server/settings/models`).
 *
 * OpenRouter's connect flow is a top-level navigation that comes back here
 * with `?openrouter=<outcome>`; the section turns that into a note and takes
 * the parameter back out of the address bar.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Badge } from "~/components/ui/badge";
import { Card, Section } from "~/components/layout/page-shell";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";

import {
    usePublishedActions,
    type SettingsSectionActions,
    type SettingsSectionProps,
} from "./contract";
import { Code, StatusNote, type StatusTone } from "./ui";
import {
    WORKSPACE_ENDPOINT_URL,
    WorkspaceModelPanel,
    type WorkspaceEndpointView,
} from "./WorkspaceModelPanel";

interface ModelRouteInfo {
    route: string;
    available: boolean;
    name?: string;
    inheritsDefault?: boolean;
    unavailableReason?: string;
}

interface ModelInfo {
    name: string;
    fromPreset: boolean;
    input: readonly string[];
    vision: boolean;
    reasoning: boolean;
    reasoningMode: string;
    structuredOutput: readonly string[];
    contextTokens: number | null;
    maxOutputTokens: number | null;
    routes: string[];
}

interface ModelsOverview {
    routes: ModelRouteInfo[];
    models: ModelInfo[];
}

/** Routes with a blurb in `settings.models.routeBlurb`. */
const ROUTE_BLURBS = ["default", "fast", "reasoning", "vision"] as const;

type ModelsT = ReturnType<typeof useTranslations<"settings.models">>;

type OpenRouterOutcome = "connected" | "denied" | "expired" | "unavailable" | "error";

const OPENROUTER_OUTCOMES: readonly OpenRouterOutcome[] = [
    "connected",
    "denied",
    "expired",
    "unavailable",
    "error",
];

function openRouterNote(
    t: ModelsT,
    outcome: OpenRouterOutcome,
    endpoint: WorkspaceEndpointView | null
): { tone: StatusTone; message: string } {
    switch (outcome) {
        case "connected":
            return endpoint?.active
                ? { tone: "ok", message: t("openRouter.connectedActive") }
                : { tone: "ok", message: t("openRouter.connected") };
        case "denied":
            return { tone: "muted", message: t("openRouter.denied") };
        case "expired":
            return { tone: "warn", message: t("openRouter.expired") };
        case "unavailable":
            return { tone: "danger", message: t("openRouter.unavailable") };
        case "error":
            return { tone: "danger", message: t("openRouter.error") };
    }
}

/**
 * Reads `?openrouter=` once and removes it, keeping the rest of the address
 * (the `#models` hash included) so a reload doesn't repeat the message.
 */
function takeOpenRouterOutcome(): OpenRouterOutcome | null {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const value = params.get("openrouter");
    if (value === null) return null;
    params.delete("openrouter");
    const query = params.toString();
    window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
    );
    return (OPENROUTER_OUTCOMES as readonly string[]).includes(value)
        ? (value as OpenRouterOutcome)
        : null;
}

export function ModelsSection({ onActions }: SettingsSectionProps) {
    const t = useTranslations("settings.models");
    const locale = useLocale();
    const [overview, setOverview] = useState<ModelsOverview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const [endpoint, setEndpoint] = useState<WorkspaceEndpointView | null>(null);
    const [endpointLoaded, setEndpointLoaded] = useState(false);
    const [endpointError, setEndpointError] = useState<string | null>(null);

    // The editor's Save, while it is open; otherwise the section offers Re-read.
    const [editorActions, setEditorActions] = useState<SettingsSectionActions | null>(null);
    const [openRouter, setOpenRouter] = useState<OpenRouterOutcome | null>(null);

    useEffect(() => {
        const outcome = takeOpenRouterOutcome();
        if (outcome) setOpenRouter(outcome);
    }, []);

    const readOverview = useCallback(async () => {
        try {
            const res = await fetch("/api/settings/models");
            const body = (await res.json().catch(() => ({}))) as ModelsOverview & {
                error?: string;
            };
            if (!res.ok)
                throw new Error(body.error ?? t("readFailedStatus", { status: res.status }));
            setOverview(body);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : t("readFailed"));
        }
    }, [t]);

    const readEndpoint = useCallback(async () => {
        try {
            const res = await fetch(WORKSPACE_ENDPOINT_URL);
            const body = (await res.json().catch(() => ({}))) as {
                endpoint?: WorkspaceEndpointView | null;
                error?: string;
            };
            if (!res.ok)
                throw new Error(body.error ?? t("endpointFailedStatus", { status: res.status }));
            setEndpoint(body.endpoint ?? null);
            setEndpointError(null);
        } catch (err) {
            setEndpointError(err instanceof Error ? err.message : t("endpointFailed"));
        } finally {
            setEndpointLoaded(true);
        }
    }, [t]);

    const refresh = useCallback(async () => {
        setLoading(true);
        await Promise.all([readOverview(), readEndpoint()]);
        setLoading(false);
    }, [readOverview, readEndpoint]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const endpointChanged = useCallback((next: WorkspaceEndpointView | null) => {
        setEndpoint(next);
        // The panel says what just happened; an OpenRouter note from before
        // the change would now be describing the past.
        setOpenRouter(null);
    }, []);

    usePublishedActions(
        onActions,
        editorActions ?? {
            primaryLabel: t("reread"),
            primaryBusyLabel: t("reading"),
            onPrimary: refresh,
            busy: loading,
        },
        [editorActions, refresh, loading, t]
    );

    const note = openRouter ? openRouterNote(t, openRouter, endpoint) : null;

    return (
        <>
            {note && <StatusNote tone={note.tone}>{note.message}</StatusNote>}

            <WorkspaceModelPanel
                endpoint={endpoint}
                loaded={endpointLoaded}
                loadError={endpointError}
                onEndpointChange={endpointChanged}
                registerActions={setEditorActions}
                openAtModels={openRouter === "connected" && endpoint !== null && !endpoint.models}
            />

            <Section title={t("server.title")} description={t("server.description")}>
                {endpoint?.active ? (
                    <StatusNote tone="muted">{t("server.usesOwn")}</StatusNote>
                ) : endpoint ? (
                    <StatusNote tone="muted">{t("server.ownNoModel")}</StatusNote>
                ) : null}

                {error && (
                    <StatusNote tone="danger">
                        {t.rich("server.fixFile", {
                            error,
                            code: chunks => <Code>{chunks}</Code>,
                        })}
                    </StatusNote>
                )}

                {!overview && loading && (
                    <StatusNote tone="muted">{t("server.readingConfig")}</StatusNote>
                )}

                {overview && (
                    <>
                        <Card>
                            <div className="text-ink-2 text-[13px]">
                                {t.rich("server.fileNote", {
                                    code: chunks => <Code>{chunks}</Code>,
                                })}
                            </div>
                        </Card>

                        <SubHeading
                            title={t("routes.title")}
                            description={t("routes.description")}
                        />
                        <Card padding={0}>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t("routes.route")}</TableHead>
                                        <TableHead>{t("routes.model")}</TableHead>
                                        <TableHead>{t("routes.assignment")}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {overview.routes.map(route => (
                                        <TableRow key={route.route}>
                                            <TableCell>
                                                <div className="text-ink font-semibold">
                                                    {route.route}
                                                </div>
                                                <div className="text-ink-3 text-[12px]">
                                                    {(ROUTE_BLURBS as readonly string[]).includes(
                                                        route.route
                                                    )
                                                        ? t(
                                                              `routeBlurb.${route.route as (typeof ROUTE_BLURBS)[number]}`
                                                          )
                                                        : null}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {route.available ? (
                                                    <div className="text-ink">{route.name}</div>
                                                ) : (
                                                    <span className="text-ink-3">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {!route.available ? (
                                                    <span title={route.unavailableReason}>
                                                        <Badge variant="warn">
                                                            {t("routes.unavailable")}
                                                        </Badge>
                                                    </span>
                                                ) : route.inheritsDefault ? (
                                                    <Badge variant="secondary">
                                                        {t("routes.inherits")}
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="success">
                                                        {t("routes.explicit")}
                                                    </Badge>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </Card>

                        <SubHeading
                            title={t("declared.title")}
                            description={t("declared.description")}
                        />
                        <div className="grid gap-3.5 md:grid-cols-2">
                            {overview.models.map(model => (
                                <Card key={model.name} padding={16}>
                                    <div className="flex items-start gap-2">
                                        <div className="min-w-0 flex-1">
                                            <div className="text-ink text-[13.5px] font-semibold">
                                                {model.name}
                                            </div>
                                        </div>
                                        {model.routes.length > 0 && (
                                            <div className="flex flex-wrap justify-end gap-1">
                                                {model.routes.map(route => (
                                                    <Badge key={route} variant="secondary">
                                                        {route}
                                                    </Badge>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <dl className="text-ink-2 mt-3 grid grid-cols-[110px_1fr] gap-y-1 text-[12.5px]">
                                        <dt className="text-ink-3">
                                            {t("declared.behaviourFrom")}
                                        </dt>
                                        <dd className="m-0">
                                            {model.fromPreset
                                                ? t("declared.preset")
                                                : t("declared.override")}
                                        </dd>
                                        <dt className="text-ink-3">{t("declared.input")}</dt>
                                        <dd className="m-0">{model.input.join(", ")}</dd>
                                        <dt className="text-ink-3">{t("declared.reasoning")}</dt>
                                        <dd className="m-0">
                                            {model.reasoning
                                                ? model.reasoningMode
                                                : t("declared.none")}
                                        </dd>
                                        <dt className="text-ink-3">{t("declared.structured")}</dt>
                                        <dd className="m-0">
                                            {model.structuredOutput.length > 0
                                                ? model.structuredOutput.join(", ")
                                                : t("declared.promptedJson")}
                                        </dd>
                                        {(model.contextTokens ?? model.maxOutputTokens) !==
                                            null && (
                                            <>
                                                <dt className="text-ink-3">
                                                    {t("declared.limits")}
                                                </dt>
                                                <dd className="m-0">
                                                    {model.contextTokens
                                                        ? t("declared.context", {
                                                              count: model.contextTokens.toLocaleString(
                                                                  locale
                                                              ),
                                                          })
                                                        : ""}
                                                    {model.contextTokens && model.maxOutputTokens
                                                        ? " · "
                                                        : ""}
                                                    {model.maxOutputTokens
                                                        ? t("declared.output", {
                                                              count: model.maxOutputTokens.toLocaleString(
                                                                  locale
                                                              ),
                                                          })
                                                        : ""}
                                                </dd>
                                            </>
                                        )}
                                    </dl>
                                </Card>
                            ))}
                        </div>
                    </>
                )}
            </Section>
        </>
    );
}

/** A heading inside the Server default section. */
function SubHeading({ title, description }: { title: string; description: string }) {
    return (
        <div className="mb-3 mt-6">
            <h3 className="text-ink m-0 text-[13.5px] font-semibold">{title}</h3>
            <div className="text-ink-3 mt-1 text-[12.5px] leading-normal">{description}</div>
        </div>
    );
}
