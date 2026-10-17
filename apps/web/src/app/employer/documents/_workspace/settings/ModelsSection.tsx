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

const ROUTE_BLURB: Record<string, string> = {
    default: "Everything not routed elsewhere: Ask, meetings, drafts.",
    fast: "Small structured calls: metadata extraction, starters, classification.",
    reasoning: "Requests that ask for a reasoning effort.",
    vision: "Requests that carry an image.",
};

type OpenRouterOutcome = "connected" | "denied" | "expired" | "unavailable" | "error";

const OPENROUTER_OUTCOMES: readonly OpenRouterOutcome[] = [
    "connected",
    "denied",
    "expired",
    "unavailable",
    "error",
];

function openRouterNote(
    outcome: OpenRouterOutcome,
    endpoint: WorkspaceEndpointView | null
): { tone: StatusTone; message: string } {
    switch (outcome) {
        case "connected":
            return endpoint?.active
                ? { tone: "ok", message: "OpenRouter is connected, and this workspace uses it." }
                : {
                      tone: "ok",
                      message:
                          "OpenRouter is connected. Choose a model to switch your workspace over.",
                  };
        case "denied":
            return {
                tone: "muted",
                message: "OpenRouter sign-in was cancelled. Nothing changed.",
            };
        case "expired":
            return { tone: "warn", message: "That sign-in expired, try again." };
        case "unavailable":
            return {
                tone: "danger",
                message:
                    "This server can't store API keys yet: whoever runs it needs to set EMBEDDING_SECRETS_KEY.",
            };
        case "error":
            return {
                tone: "danger",
                message: "Couldn't connect OpenRouter. Try again, or use an API key instead.",
            };
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
                throw new Error(body.error ?? `Could not read the configuration (${res.status}).`);
            setOverview(body);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not read the configuration.");
        }
    }, []);

    const readEndpoint = useCallback(async () => {
        try {
            const res = await fetch(WORKSPACE_ENDPOINT_URL);
            const body = (await res.json().catch(() => ({}))) as {
                endpoint?: WorkspaceEndpointView | null;
                error?: string;
            };
            if (!res.ok)
                throw new Error(body.error ?? `Couldn't read your model setup (${res.status}).`);
            setEndpoint(body.endpoint ?? null);
            setEndpointError(null);
        } catch (err) {
            setEndpointError(
                err instanceof Error ? err.message : "Couldn't read your model setup."
            );
        } finally {
            setEndpointLoaded(true);
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

    const endpointChanged = useCallback((next: WorkspaceEndpointView | null) => {
        setEndpoint(next);
        // The panel says what just happened; an OpenRouter note from before
        // the change would now be describing the past.
        setOpenRouter(null);
    }, []);

    usePublishedActions(
        onActions,
        editorActions ?? {
            primaryLabel: "Re-read",
            primaryBusyLabel: "Reading…",
            onPrimary: refresh,
            busy: loading,
        },
        [editorActions, refresh, loading]
    );

    const note = openRouter ? openRouterNote(openRouter, endpoint) : null;

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

            <Section
                title="Server default"
                description="The models this server runs any workspace on that hasn't brought its own. One AI endpoint serves every route; its address and credential stay on the server."
            >
                {endpoint?.active ? (
                    <StatusNote tone="muted">
                        This workspace uses its own model, so the server default below isn&rsquo;t
                        used.
                    </StatusNote>
                ) : endpoint ? (
                    <StatusNote tone="muted">
                        Your own model is connected but has no model chosen, so this workspace still
                        runs on the server default.
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
