"use client";

/**
 * Settings › Models.
 *
 * Body only: the server default — what the server resolved from its chat
 * configuration file, a table of routes, then a card per configured model
 * saying what it can do. It never names the vendor, the endpoint, or the model
 * id — the server doesn't send them (see `~/server/settings/models`).
 *
 * A workspace that brings its own model sets it up in Settings › Bring your own
 * keys; this section only reads whether it has, to say the default is unused.
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
    const [endpoint, setEndpoint] = useState<WorkspaceEndpointView | null>(null);

    const readOverview = useCallback(async () => {
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
        }
    }, []);

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
            primaryLabel: "Re-read",
            primaryBusyLabel: "Reading…",
            onPrimary: refresh,
            busy: loading,
        },
        [refresh, loading]
    );

    return (
        <>
            <Section
                title="Server default"
                description="The models this server runs any workspace on that hasn't brought its own. One AI endpoint serves every route; its address and credential stay on the server."
            >
                {endpoint?.active ? (
                    <StatusNote tone="muted">
                        This workspace runs on its own model, set up in Bring your own keys, so the
                        server default below isn&rsquo;t used.
                    </StatusNote>
                ) : endpoint ? (
                    <StatusNote tone="muted">
                        This workspace&rsquo;s own API key has no model chosen yet, so it still runs
                        on the server default. Choose one in Bring your own keys.
                    </StatusNote>
                ) : null}

                {error && (
                    <StatusNote tone="danger">
                        {error} Fix the file named by <Code>CHAT_MODELS_CONFIG</Code> and re-read.
                    </StatusNote>
                )}

                {!overview && loading && (
                    <StatusNote tone="muted">Reading the configuration…</StatusNote>
                )}

                {overview && (
                    <>
                        <Card>
                            <div className="text-ink-2 text-[13px]">
                                Models are set in the server&rsquo;s chat model file, named by{" "}
                                <Code>CHAT_MODELS_CONFIG</Code>. Edit that file and restart to
                                change a model; nothing here writes to it.
                            </div>
                        </Card>

                        <SubHeading
                            title="Routes"
                            description="A route is a capability the app asks for. A route with no explicit model inherits default when default can serve it."
                        />
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
                                                    <div className="text-ink">{route.name}</div>
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

                        <SubHeading
                            title="Declared models"
                            description="What each configured model is declared to do. A preset is a verified catalog entry; an override is the operator's own word, taken as given."
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
                                        <dt className="text-ink-3">Behaviour from</dt>
                                        <dd className="m-0">
                                            {model.fromPreset
                                                ? "a verified preset"
                                                : "the configuration file (operator override)"}
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
