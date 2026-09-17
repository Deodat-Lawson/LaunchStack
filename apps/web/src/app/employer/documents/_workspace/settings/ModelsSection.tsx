"use client";

/**
 * Models and routes — read-only in v1.
 *
 * Body only. Renders what the server resolved from the chat configuration
 * file: a table of routes, then a card per model saying what it declares
 * and where that came from (a bundled preset with a verified-on date, or an
 * operator override in the file). The point is to make the YAML legible
 * before anyone asks to make it editable.
 */

import React, { useCallback, useEffect, useState } from "react";

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

interface ModelRouteInfo {
    route: string;
    available: boolean;
    name?: string;
    modelId?: string;
    inheritsDefault?: boolean;
    unavailableReason?: string;
}

interface ModelInfo {
    name: string;
    modelId: string;
    preset: string | null;
    presetSource: string | null;
    verifiedOn: string | null;
    presetNotes: string | null;
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
    endpointHost: string | null;
    configFile: string;
    routes: ModelRouteInfo[];
    models: ModelInfo[];
}

const ROUTE_BLURB: Record<string, string> = {
    default: "Everything not routed elsewhere: Ask, meetings, drafts.",
    fast: "Small structured calls: metadata extraction, starters, classification.",
    reasoning: "Requests that ask for a reasoning effort.",
    vision: "Requests that carry an image.",
};

export function ModelsSection({ onActions }: SettingsSectionProps) {
    const [overview, setOverview] = useState<ModelsOverview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/settings/models");
            const body = (await res.json().catch(() => ({}))) as ModelsOverview & {
                error?: string;
            };
            if (!res.ok)
                throw new Error(body.error ?? `Could not read the configuration (${res.status}).`);
            setOverview(body);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not read the configuration.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    usePublishedActions(
        onActions,
        {
            primaryLabel: "Re-read",
            primaryBusyLabel: "Reading…",
            onPrimary: refresh,
            busy: loading,
        },
        [refresh, loading]
    );

    if (loading && !overview)
        return <StatusNote tone="muted">Reading the configuration…</StatusNote>;

    return (
        <>
            {error && (
                <StatusNote tone="danger">
                    {error} Fix the file named by <Code>CHAT_MODELS_CONFIG</Code> and re-read.
                </StatusNote>
            )}
            {overview && (
                <>
                    <Section
                        title="Endpoint"
                        description="One OpenAI-compatible endpoint serves every route. Its credential stays on the server."
                    >
                        <Card>
                            <div className="text-ink-2 text-[13px]">
                                Talking to <Code>{overview.endpointHost ?? "unknown"}</Code>,
                                configured in <Code>{overview.configFile}</Code>. Edit that file and
                                restart to change a model; nothing here writes to it.
                            </div>
                        </Card>
                    </Section>

                    <Section
                        title="Routes"
                        description="A route is a capability the app asks for. A route with no explicit model inherits default when default can serve it."
                    >
                        <Card padding={0}>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Route</TableHead>
                                        <TableHead>Model</TableHead>
                                        <TableHead>Assignment</TableHead>
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
                                                    {ROUTE_BLURB[route.route]}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {route.available ? (
                                                    <>
                                                        <div className="text-ink">{route.name}</div>
                                                        <div className="mono text-ink-3 text-[11.5px]">
                                                            {route.modelId}
                                                        </div>
                                                    </>
                                                ) : (
                                                    <span className="text-ink-3">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {!route.available ? (
                                                    <span title={route.unavailableReason}>
                                                        <Badge variant="warn">Unavailable</Badge>
                                                    </span>
                                                ) : route.inheritsDefault ? (
                                                    <Badge variant="secondary">
                                                        Inherits default
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="success">Explicit</Badge>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </Card>
                    </Section>

                    <Section
                        title="Declared models"
                        description="What each model is declared to do. A preset is a verified catalog entry; an override is the operator's own word, taken as given."
                    >
                        <div className="grid gap-3.5 md:grid-cols-2">
                            {overview.models.map(model => (
                                <Card key={model.name} padding={16}>
                                    <div className="flex items-start gap-2">
                                        <div className="min-w-0 flex-1">
                                            <div className="text-ink text-[13.5px] font-semibold">
                                                {model.name}
                                            </div>
                                            <div className="mono text-ink-3 text-[11.5px]">
                                                {model.modelId}
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
                                        <dt className="text-ink-3">Behaviour from</dt>
                                        <dd className="m-0">
                                            {model.preset ? (
                                                <>
                                                    preset <Code>{model.preset}</Code>
                                                    {model.verifiedOn && (
                                                        <>
                                                            , checked {model.verifiedOn}
                                                            {model.presetSource && (
                                                                <>
                                                                    {" "}
                                                                    against{" "}
                                                                    <a
                                                                        href={model.presetSource}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                        className="text-brand-ink underline"
                                                                    >
                                                                        its source
                                                                    </a>
                                                                </>
                                                            )}
                                                        </>
                                                    )}
                                                </>
                                            ) : (
                                                "the configuration file (operator override)"
                                            )}
                                        </dd>
                                        <dt className="text-ink-3">Input</dt>
                                        <dd className="m-0">{model.input.join(", ")}</dd>
                                        <dt className="text-ink-3">Reasoning</dt>
                                        <dd className="m-0">
                                            {model.reasoning ? model.reasoningMode : "none"}
                                        </dd>
                                        <dt className="text-ink-3">Structured output</dt>
                                        <dd className="m-0">
                                            {model.structuredOutput.length > 0
                                                ? model.structuredOutput.join(", ")
                                                : "prompted JSON"}
                                        </dd>
                                        {(model.contextTokens ?? model.maxOutputTokens) !==
                                            null && (
                                            <>
                                                <dt className="text-ink-3">Limits</dt>
                                                <dd className="m-0">
                                                    {model.contextTokens
                                                        ? `${model.contextTokens.toLocaleString()} context`
                                                        : ""}
                                                    {model.contextTokens && model.maxOutputTokens
                                                        ? " · "
                                                        : ""}
                                                    {model.maxOutputTokens
                                                        ? `${model.maxOutputTokens.toLocaleString()} output`
                                                        : ""}
                                                </dd>
                                            </>
                                        )}
                                    </dl>
                                    {model.presetNotes && (
                                        <p className="text-ink-3 m-0 mt-2 text-[12px] leading-normal">
                                            {model.presetNotes}
                                        </p>
                                    )}
                                </Card>
                            ))}
                        </div>
                    </Section>
                </>
            )}
        </>
    );
}
