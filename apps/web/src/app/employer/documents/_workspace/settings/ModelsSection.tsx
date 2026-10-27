"use client";

/**
 * Workspace › Models.
 *
 * Body only: the server default — what the server resolved from its chat
 * configuration file, a table of routes, then a card per configured model
 * saying what it can do. It never names the vendor, the endpoint, or the model
 * id — the server doesn't send them (see `~/server/settings/models`).
 *
 * A workspace that brings its own model sets it up in Workspace › Bring your
 * own keys; this section only reads whether it has, to say the default is
 * unused.
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

import { usePublishedActions, type SettingsSectionProps } from "./contract";
import { Code, StatusNote } from "./ui";
import { WORKSPACE_ENDPOINT_URL, type WorkspaceEndpointView } from "./WorkspaceModelPanel";

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

export function ModelsSection({ onActions }: SettingsSectionProps) {
    const t = useTranslations("settings.models");
    const locale = useLocale();
    const [overview, setOverview] = useState<ModelsOverview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [endpoint, setEndpoint] = useState<WorkspaceEndpointView | null>(null);

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

    // Only to say whether the default below is in use; a failure here just
    // leaves that note out.
    const readEndpoint = useCallback(async () => {
        try {
            const res = await fetch(WORKSPACE_ENDPOINT_URL);
            if (!res.ok) return;
            const body = (await res.json().catch(() => ({}))) as {
                endpoint?: WorkspaceEndpointView | null;
            };
            setEndpoint(body.endpoint ?? null);
        } catch {
            // The note is optional.
        }
    }, []);

    const refresh = useCallback(async () => {
        setLoading(true);
        await Promise.all([readOverview(), readEndpoint()]);
        setLoading(false);
    }, [readOverview, readEndpoint]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    usePublishedActions(
        onActions,
        {
            primaryLabel: t("reread"),
            primaryBusyLabel: t("reading"),
            onPrimary: refresh,
            busy: loading,
        },
        [refresh, loading, t]
    );

    return (
        <>
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
