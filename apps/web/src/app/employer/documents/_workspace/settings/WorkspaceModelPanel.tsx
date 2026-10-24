"use client";

/**
 * Settings › Bring your own keys › API key.
 *
 * A workspace admin points the workspace's AI — chat, drafting, meetings,
 * background work — at their own provider account: OpenRouter in one click,
 * or any OpenAI-compatible address and API key. Three states over
 * `/api/settings/models/workspace`: not connected, editing, connected.
 *
 * The key goes in and never comes back out. The server answers with
 * `hasKey` and the last four characters, and a typed key is cleared from the
 * form the moment it is saved. A saved key is only ever sent to the address
 * it was saved with, so changing the address asks for the key again.
 *
 * The editor's Save is published as the section's primary action, so it sits
 * in the settings chrome like every other section's Save.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, ChevronRight, ExternalLink, XCircle } from "lucide-react";

import { Card, Section } from "~/components/layout/page-shell";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import {
    MODEL_PROVIDERS,
    getModelProvider,
    isModelProviderId,
    type ModelProviderId,
    type ModelProviderOption,
} from "~/lib/ai/model-providers";
import { cn } from "~/lib/utils";

import { usePublishedActions, type RegisterSectionActions } from "./contract";
import { useTimeFormat } from "./people/format";
import { StatusNote, type StatusTone } from "./ui";

// ---------------------------------------------------------------------------
// Wire shapes (mirrors of `~/server/workspace-models/store`, which a client
// component must not import)
// ---------------------------------------------------------------------------

export interface WorkspaceModelChoice {
    id: string;
    vision: boolean;
    reasoning: boolean;
    structuredOutput?: boolean;
}

export interface WorkspaceModelSelection {
    default: WorkspaceModelChoice;
    fast?: WorkspaceModelChoice;
    reasoning?: WorkspaceModelChoice;
    vision?: WorkspaceModelChoice;
}

export interface WorkspaceEndpointView {
    provider: ModelProviderId;
    baseUrl: string;
    hasKey: boolean;
    keyLast4: string | null;
    models: WorkspaceModelSelection | null;
    /** A default model is chosen, so the workspace's work runs here. */
    active: boolean;
    connectedVia: "key" | "openrouter";
    updatedAt: string;
    updatedBy: string | null;
}

type RouteId = "default" | "fast" | "reasoning" | "vision";

interface TestResult {
    route: RouteId;
    modelId: string;
    ok: boolean;
    latencyMs: number;
    message?: string;
}

export const WORKSPACE_ENDPOINT_URL = "/api/settings/models/workspace";
const MODELS_URL = `${WORKSPACE_ENDPOINT_URL}/models`;
const TEST_URL = `${WORKSPACE_ENDPOINT_URL}/test`;
const OPENROUTER_URL = `${WORKSPACE_ENDPOINT_URL}/openrouter`;

/** Words: `settings.workspaceModel.routes.<id>` (`label`, `short`, `hint`). */
const ROUTES: readonly { id: RouteId }[] = [
    { id: "default" },
    { id: "fast" },
    { id: "reasoning" },
    { id: "vision" },
];

/** `useTranslations("settings.workspaceModel")`. */
type PanelT = ReturnType<typeof useTranslations<"settings.workspaceModel">>;

/** A provider's name: brands as they are, "Other" in the reader's language. */
function providerLabel(t: PanelT, option: ModelProviderOption): string {
    return option.id === "custom" ? t("providers.custom.label") : option.label;
}

/** The line under the provider picker. */
function providerNote(t: PanelT, option: ModelProviderOption): string | undefined {
    if (!option.note) return undefined;
    if (option.id === "anthropic" || option.id === "openrouter" || option.id === "custom")
        return t(`providers.${option.id}.note`);
    return option.note;
}

const EXTRA_ROUTES = ROUTES.filter(route => route.id !== "default");

/** Leaving the workspace for openrouter.ai to approve a key; it comes back here. */
function connectOpenRouter() {
    window.location.href = OPENROUTER_URL;
}

/**
 * Tidy an address the way the server does before it stores or compares one,
 * so "the address is unchanged" means what the server will decide.
 */
export function normalizeBaseUrl(raw: string): string {
    const text = raw.trim();
    try {
        const url = new URL(text);
        return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
    } catch {
        return text.replace(/\/+$/, "");
    }
}

/** A failed call the server gave no sentence for; said with its status. */
class ServerAnswered extends Error {
    constructor(readonly status: number) {
        super(`The server answered ${status}.`);
        this.name = "ServerAnswered";
    }
}

async function sendJson<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
        if (data.error) throw new Error(data.error);
        throw new ServerAnswered(res.status);
    }
    return data;
}

function messageOf(t: PanelT, error: unknown, fallback: string): string {
    if (error instanceof ServerAnswered) return t("serverAnswered", { status: error.status });
    return error instanceof Error && error.message ? error.message : fallback;
}

function formatLatency(ms: number): string {
    return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
}

// ---------------------------------------------------------------------------
// Connection test, shared by the editor and the summary
// ---------------------------------------------------------------------------

type TestState =
    | { status: "idle" }
    | { status: "running"; count: number }
    | { status: "done"; ok: boolean; results: TestResult[] }
    | { status: "failed"; message: string };

function distinctModels(selection: WorkspaceModelSelection): number {
    return new Set(
        ROUTES.map(route => selection[route.id]?.id.trim()).filter((id): id is string =>
            Boolean(id)
        )
    ).size;
}

function useConnectionTest() {
    const t = useTranslations("settings.workspaceModel");
    const [state, setState] = useState<TestState>({ status: "idle" });
    const run = useCallback(
        async (body: Record<string, unknown>) => {
            const selection = body.models as WorkspaceModelSelection;
            setState({ status: "running", count: distinctModels(selection) });
            try {
                const data = await sendJson<{ ok: boolean; results: TestResult[] }>(
                    "POST",
                    TEST_URL,
                    body
                );
                setState({ status: "done", ok: data.ok, results: data.results ?? [] });
            } catch (error) {
                setState({ status: "failed", message: messageOf(t, error, t("testFailed")) });
            }
        },
        [t]
    );
    const reset = useCallback(() => setState({ status: "idle" }), []);
    return { state, run, reset };
}

function TestOutcome({ state }: { state: TestState }) {
    const t = useTranslations("settings.workspaceModel");
    if (state.status === "idle") return null;
    if (state.status === "running") {
        return (
            <div role="status" className="text-ink-3 mt-3 flex items-center gap-2 text-[12.5px]">
                <Spinner aria-hidden="true" />
                {t("testing", { count: state.count })}
            </div>
        );
    }
    if (state.status === "failed") {
        return (
            <StatusNote tone="danger" style={{ marginTop: 12, marginBottom: 0 }}>
                {state.message}
            </StatusNote>
        );
    }
    const routeLabel = (id: RouteId) =>
        ROUTES.some(route => route.id === id) ? t(`routes.${id}.short`) : id;
    return (
        <div className="mt-3" role="status">
            <div
                className={cn(
                    "text-[12.5px] font-semibold",
                    state.ok ? "text-success" : "text-danger"
                )}
            >
                {state.ok ? t("allAnswered") : t("notAllAnswered")}
            </div>
            <ul className="m-0 mt-1.5 list-none p-0" aria-label={t("testResults")}>
                {state.results.map(result => (
                    <li key={result.route} className="flex items-start gap-2 py-1">
                        {result.ok ? (
                            <CheckCircle2
                                aria-hidden
                                className="text-success mt-0.5 size-4 shrink-0"
                            />
                        ) : (
                            <XCircle aria-hidden className="text-danger mt-0.5 size-4 shrink-0" />
                        )}
                        <div className="min-w-0 text-[12.5px]">
                            <span className="sr-only">
                                {result.ok ? t("passed") : t("failed")}{" "}
                            </span>
                            <span className="text-ink font-medium">{routeLabel(result.route)}</span>{" "}
                            <span className="mono text-ink-3 break-all text-[11.5px]">
                                {result.modelId}
                            </span>
                            <div className={result.ok ? "text-ink-3" : "text-danger"}>
                                {result.ok
                                    ? t("answeredIn", { latency: formatLatency(result.latencyMs) })
                                    : (result.message ?? t("noAnswer"))}
                            </div>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export interface WorkspaceModelPanelProps {
    endpoint: WorkspaceEndpointView | null;
    /** The first read has answered (successfully or not). */
    loaded: boolean;
    loadError: string | null;
    /** Saved, connected or disconnected: the section's other parts follow. */
    onEndpointChange: (endpoint: WorkspaceEndpointView | null) => void;
    /** Where the editor publishes its Save and Cancel; null when it closes. */
    registerActions: RegisterSectionActions;
    /** Open the editor at the model step (OpenRouter just connected, no model yet). */
    openAtModels?: boolean;
}

export function WorkspaceModelPanel({
    endpoint,
    loaded,
    loadError,
    onEndpointChange,
    registerActions,
    openAtModels = false,
}: WorkspaceModelPanelProps) {
    const t = useTranslations("settings.workspaceModel");
    const tc = useTranslations("common");
    const [editing, setEditing] = useState(false);
    const [focusModels, setFocusModels] = useState(false);
    const [note, setNote] = useState<{ tone: StatusTone; message: string } | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const openedForModels = useRef(false);
    const noteRef = useRef<HTMLDivElement>(null);

    // Saving from the bottom of a long form leaves the pane scrolled past the
    // outcome; bring the note into view so the admin sees what happened.
    useEffect(() => {
        if (note) noteRef.current?.scrollIntoView?.({ block: "nearest" });
    }, [note]);

    useEffect(() => {
        if (!openAtModels || openedForModels.current || !endpoint) return;
        openedForModels.current = true;
        setFocusModels(true);
        setEditing(true);
    }, [openAtModels, endpoint]);

    const startEditing = useCallback((atModels: boolean) => {
        setNote(null);
        setFocusModels(atModels);
        setEditing(true);
    }, []);

    const cancel = useCallback(() => {
        setEditing(false);
        setFocusModels(false);
    }, []);

    const saved = useCallback(
        (next: WorkspaceEndpointView) => {
            setEditing(false);
            setFocusModels(false);
            setNote({
                tone: "ok",
                message: next.active ? t("savedActive") : t("savedChoose"),
            });
            onEndpointChange(next);
        },
        [onEndpointChange, t]
    );

    const disconnect = useCallback(async () => {
        setDisconnecting(true);
        setNote(null);
        try {
            await sendJson<{ endpoint: null }>("DELETE", WORKSPACE_ENDPOINT_URL);
            setNote({ tone: "ok", message: t("disconnected") });
            onEndpointChange(null);
        } catch (error) {
            setNote({ tone: "danger", message: messageOf(t, error, t("disconnectFailed")) });
        } finally {
            setDisconnecting(false);
        }
    }, [onEndpointChange, t]);

    return (
        <Section title={t("section.title")} description={t("section.description")}>
            {note && (
                <div ref={noteRef} role="status">
                    <StatusNote tone={note.tone}>{note.message}</StatusNote>
                </div>
            )}

            {!loaded ? (
                <StatusNote tone="muted">{t("checking")}</StatusNote>
            ) : loadError ? (
                <StatusNote tone="danger">{loadError}</StatusNote>
            ) : editing ? (
                <EndpointEditor
                    initial={endpoint}
                    focusModels={focusModels}
                    registerActions={registerActions}
                    onCancel={cancel}
                    onSaved={saved}
                />
            ) : endpoint ? (
                <EndpointSummary
                    endpoint={endpoint}
                    busy={disconnecting}
                    onEdit={() => startEditing(!endpoint.active)}
                    onDisconnect={() => setConfirmOpen(true)}
                />
            ) : (
                <Card>
                    <div className="flex flex-wrap gap-2">
                        <Button onClick={connectOpenRouter}>{t("connectOpenRouter")}</Button>
                        <Button variant="outline" onClick={() => startEditing(false)}>
                            {t("useApiKey")}
                        </Button>
                    </div>
                    <p className="text-ink-3 m-0 mt-3 text-[12.5px] leading-normal">{t("intro")}</p>
                </Card>
            )}

            <ConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title={t("confirm.title")}
                description={t("confirm.description")}
                confirmLabel={tc("actions.disconnect")}
                onConfirm={() => void disconnect()}
            />
        </Section>
    );
}

// ---------------------------------------------------------------------------
// Connected summary
// ---------------------------------------------------------------------------

/**
 * Whether an unset route really falls back to the main model. Images and
 * reasoning only do when the main model can do them; otherwise the server
 * refuses those requests, and saying "Main model" would hide that.
 */
function inheritsMain(route: RouteId, main: WorkspaceModelChoice | undefined): boolean {
    if (route === "vision") return Boolean(main?.vision);
    if (route === "reasoning") return Boolean(main?.reasoning);
    return true;
}

function capabilities(t: PanelT, choice: WorkspaceModelChoice): string {
    const said = [
        choice.vision && t("capabilities.readsImages"),
        choice.reasoning && t("capabilities.reasons"),
        choice.structuredOutput && t("capabilities.jsonSchema"),
    ].filter(Boolean);
    return said.length ? ` · ${said.join(t("listSeparator"))}` : "";
}

function EndpointSummary({
    endpoint,
    busy,
    onEdit,
    onDisconnect,
}: {
    endpoint: WorkspaceEndpointView;
    busy: boolean;
    onEdit: () => void;
    onDisconnect: () => void;
}) {
    const t = useTranslations("settings.workspaceModel");
    const tc = useTranslations("common");
    const time = useTimeFormat();
    const test = useConnectionTest();
    const provider = getModelProvider(endpoint.provider);
    const key = endpoint.hasKey
        ? endpoint.keyLast4
            ? t("summary.keyEnding", { last4: endpoint.keyLast4 })
            : t("summary.keySaved")
        : t("summary.noKey");
    const when = time.relative(endpoint.updatedAt);

    return (
        <Card>
            <div className="flex flex-wrap items-center gap-2">
                <div className="text-ink min-w-0 flex-1 text-[14px] font-semibold">
                    {providerLabel(t, provider)}
                </div>
                <Badge variant={endpoint.active ? "success" : "warn"}>
                    {endpoint.active ? t("summary.active") : t("summary.chooseModel")}
                </Badge>
            </div>
            {!endpoint.active && (
                <p className="text-ink-3 m-0 mt-1.5 text-[12.5px] leading-normal">
                    {t("summary.notChosenNote")}
                </p>
            )}

            <dl className="m-0 mt-3 grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
                <dt className="text-ink-3">{t("summary.address")}</dt>
                <dd className="mono text-ink-2 m-0 break-all text-[11.5px] leading-[1.6]">
                    {endpoint.baseUrl}
                </dd>
                <dt className="text-ink-3">{t("summary.key")}</dt>
                <dd className="text-ink-2 m-0">{key}</dd>
                {ROUTES.map(route => {
                    const choice = endpoint.models?.[route.id];
                    return (
                        <React.Fragment key={route.id}>
                            <dt className="text-ink-3">{t(`routes.${route.id}.short`)}</dt>
                            <dd className="text-ink-2 m-0 min-w-0">
                                {choice ? (
                                    <>
                                        <span className="mono break-all text-[11.5px]">
                                            {choice.id}
                                        </span>
                                        <span className="text-ink-3">
                                            {capabilities(t, choice)}
                                        </span>
                                    </>
                                ) : route.id === "default" ? (
                                    <span className="text-ink-3">{t("summary.notChosen")}</span>
                                ) : inheritsMain(route.id, endpoint.models?.default) ? (
                                    <span className="text-ink-3">{t("summary.mainModel")}</span>
                                ) : (
                                    <span className="text-ink-3">
                                        {route.id === "vision"
                                            ? t("summary.offNoImages")
                                            : t("summary.offNoReason")}
                                    </span>
                                )}
                            </dd>
                        </React.Fragment>
                    );
                })}
            </dl>

            <div className="text-ink-3 mt-3 text-[12px]">
                {endpoint.updatedBy
                    ? t("summary.lastChangedBy", { who: endpoint.updatedBy, when })
                    : t("summary.lastChanged", { when })}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={onEdit} disabled={busy}>
                    {tc("actions.edit")}
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !endpoint.models || test.state.status === "running"}
                    title={endpoint.models ? undefined : t("summary.chooseFirst")}
                    onClick={() => {
                        if (!endpoint.models) return;
                        // No key in the body: the server uses the saved one,
                        // which belongs to exactly this address.
                        void test.run({
                            provider: endpoint.provider,
                            baseUrl: endpoint.baseUrl,
                            models: endpoint.models,
                        });
                    }}
                >
                    {test.state.status === "running" ? t("testingShort") : t("test")}
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:text-danger"
                    onClick={onDisconnect}
                    disabled={busy}
                >
                    {busy ? t("disconnecting") : tc("actions.disconnect")}
                </Button>
            </div>
            <TestOutcome state={test.state} />
        </Card>
    );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

interface ChoiceDraft {
    id: string;
    vision: boolean;
    reasoning: boolean;
    /** Unset until the admin touches it: the provider's default stands. */
    structuredOutput?: boolean;
}

type Drafts = Record<RouteId, ChoiceDraft>;

const EMPTY_CHOICE: ChoiceDraft = { id: "", vision: false, reasoning: false };

function draftsFrom(selection: WorkspaceModelSelection | null): Drafts {
    const copy = (choice?: WorkspaceModelChoice): ChoiceDraft =>
        choice ? { ...choice } : { ...EMPTY_CHOICE };
    return {
        default: copy(selection?.default),
        fast: copy(selection?.fast),
        reasoning: copy(selection?.reasoning),
        vision: copy(selection?.vision),
    };
}

function selectionFrom(drafts: Drafts, provider: ModelProviderId): WorkspaceModelSelection | null {
    const structuredByDefault = getModelProvider(provider).structuredOutputByDefault;
    const pick = (draft: ChoiceDraft): WorkspaceModelChoice => ({
        id: draft.id.trim(),
        vision: draft.vision,
        reasoning: draft.reasoning,
        structuredOutput: draft.structuredOutput ?? structuredByDefault,
    });
    if (!drafts.default.id.trim()) return null;
    const selection: WorkspaceModelSelection = { default: pick(drafts.default) };
    for (const route of EXTRA_ROUTES) {
        const draft = drafts[route.id];
        if (draft.id.trim()) selection[route.id] = pick(draft);
    }
    return selection;
}

/** The first thing wrong with one route's choice, in words an admin can act on. */
function routeProblem(t: PanelT, route: RouteId, draft: ChoiceDraft): string | null {
    const id = draft.id.trim();
    if (!id) return null;
    if (/\s/.test(id) || id.length > 200) return t("problems.badId");
    if (route === "reasoning" && !draft.reasoning) return t("problems.needsReasoning");
    if (route === "vision" && !draft.vision) return t("problems.needsVision");
    return null;
}

function EndpointEditor({
    initial,
    focusModels,
    registerActions,
    onCancel,
    onSaved,
}: {
    initial: WorkspaceEndpointView | null;
    focusModels: boolean;
    registerActions: RegisterSectionActions;
    onCancel: () => void;
    onSaved: (endpoint: WorkspaceEndpointView) => void;
}) {
    const t = useTranslations("settings.workspaceModel");
    const tc = useTranslations("common");
    const ids = useId();
    const providerId = `${ids}-provider`;
    const urlId = `${ids}-url`;
    const keyId = `${ids}-key`;
    const keylessId = `${ids}-keyless`;
    const listId = `${ids}-models`;

    const [provider, setProvider] = useState<ModelProviderId>(initial?.provider ?? "openai");
    const [baseUrl, setBaseUrl] = useState(
        initial?.baseUrl ?? getModelProvider(initial?.provider ?? "openai").baseUrl
    );
    const [apiKey, setApiKey] = useState("");
    const [keyless, setKeyless] = useState(
        Boolean(initial && !initial.hasKey && initial.provider === "custom")
    );
    const [drafts, setDrafts] = useState<Drafts>(() => draftsFrom(initial?.models ?? null));
    const [moreOpen, setMoreOpen] = useState(
        Boolean(initial?.models?.fast ?? initial?.models?.reasoning ?? initial?.models?.vision)
    );
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [listing, setListing] = useState<
        | { status: "idle" }
        | { status: "loading" }
        | { status: "done"; count: number }
        | {
              status: "failed";
              message: string;
          }
    >({ status: "idle" });
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const test = useConnectionTest();
    const mainRef = useRef<HTMLInputElement>(null);

    const preset = getModelProvider(provider);
    const trimmedUrl = baseUrl.trim();
    const urlChanged = !initial || normalizeBaseUrl(baseUrl) !== initial.baseUrl;
    const canKeepKey = Boolean(initial?.hasKey) && !urlChanged;
    const allowsKeyless = provider === "custom";
    const isKeyless = allowsKeyless && keyless;
    const typedKey = apiKey.trim();
    /**
     * What `apiKey` carries: a typed key, null for a keyless endpoint,
     * undefined to keep the saved one. `missing` blocks Save.
     */
    const key: { value: string | null | undefined; missing: boolean } = typedKey
        ? { value: typedKey, missing: false }
        : isKeyless
          ? { value: null, missing: false }
          : { value: undefined, missing: !canKeepKey };

    const connection = useMemo(() => {
        const body: Record<string, unknown> = { provider, baseUrl: trimmedUrl };
        if (key.value !== undefined) body.apiKey = key.value;
        return body;
    }, [provider, trimmedUrl, key.value]);

    const selection = selectionFrom(drafts, provider);
    const problems = Object.fromEntries(
        ROUTES.map(route => [route.id, routeProblem(t, route.id, drafts[route.id])])
    ) as Record<RouteId, string | null>;
    const hasProblem = Object.values(problems).some(Boolean);

    const blockers = [
        !trimmedUrl && t("blockers.address"),
        key.missing && t("blockers.apiKey"),
        !selection && t("blockers.mainModel"),
    ].filter((item): item is string => Boolean(item));
    const valid = blockers.length === 0 && !hasProblem;

    const loadModels = useCallback(async () => {
        if (!trimmedUrl) return;
        setListing({ status: "loading" });
        try {
            const data = await sendJson<{ models: string[] }>("POST", MODELS_URL, connection);
            const models = [...new Set(data.models ?? [])].sort((a, b) => a.localeCompare(b));
            setSuggestions(models);
            setListing({ status: "done", count: models.length });
        } catch (error) {
            setListing({
                status: "failed",
                message: messageOf(t, error, t("listFailed")),
            });
        }
    }, [connection, trimmedUrl, t]);

    // Straight back from OpenRouter, the next step is picking a model: put
    // the cursor there and fill the suggestions with what the key can reach.
    const focusedOnce = useRef(false);
    useEffect(() => {
        if (!focusModels || focusedOnce.current) return;
        focusedOnce.current = true;
        mainRef.current?.focus();
        void loadModels();
    }, [focusModels, loadModels]);

    const save = useCallback(async () => {
        const chosen = selectionFrom(drafts, provider);
        if (!valid || !chosen) return;
        setSaving(true);
        setSaveError(null);
        try {
            const data = await sendJson<{ endpoint: WorkspaceEndpointView | null }>(
                "PUT",
                WORKSPACE_ENDPOINT_URL,
                { ...connection, models: chosen }
            );
            if (!data.endpoint) throw new Error(t("saveFailed"));
            // The key has done its job; don't keep it in the page.
            setApiKey("");
            onSaved(data.endpoint);
        } catch (error) {
            setSaveError(messageOf(t, error, t("saveFailed")));
        } finally {
            setSaving(false);
        }
    }, [valid, drafts, provider, connection, onSaved, t]);

    usePublishedActions(
        registerActions,
        {
            primaryLabel: tc("actions.save"),
            primaryBusyLabel: tc("status.saving"),
            onPrimary: save,
            busy: saving,
            disabled: !valid,
            secondary: (
                <Button variant="outline" onClick={onCancel} disabled={saving}>
                    {tc("actions.cancel")}
                </Button>
            ),
        },
        [save, saving, valid, onCancel, tc]
    );

    const pickProvider = (next: string) => {
        if (!isModelProviderId(next) || next === provider) return;
        setProvider(next);
        // Back to the saved provider restores the saved address; any other
        // fills in that provider's own.
        setBaseUrl(
            initial && initial.provider === next ? initial.baseUrl : getModelProvider(next).baseUrl
        );
        setKeyless(next === "custom" && initial?.provider === "custom" && !initial.hasKey);
        // "Follows a JSON schema" is a property of the provider's API as much
        // as the model's: back on the saved provider it shows what was saved,
        // on any other it starts from that provider's default again.
        const savedChoices = draftsFrom(initial?.models ?? null);
        const backToSaved = initial?.provider === next;
        setDrafts(current => {
            const reset = { ...current };
            for (const route of Object.keys(current) as RouteId[]) {
                reset[route] = {
                    ...current[route],
                    structuredOutput: backToSaved
                        ? savedChoices[route].structuredOutput
                        : undefined,
                };
            }
            return reset;
        });
        setSuggestions([]);
        setListing({ status: "idle" });
        test.reset();
    };

    const editRoute = (route: RouteId, patch: Partial<ChoiceDraft>) =>
        setDrafts(current => ({ ...current, [route]: { ...current[route], ...patch } }));

    const keyPlaceholder = canKeepKey
        ? initial?.keyLast4
            ? t("editor.keepEnding", { last4: initial.keyLast4 })
            : t("editor.keepSaved")
        : isKeyless
          ? t("summary.noKey")
          : preset.keyRequired
            ? t("editor.paste")
            : t("editor.pasteOptional");

    const keyHint =
        initial?.hasKey && urlChanged ? t("editor.keyHintChanged") : t("editor.keyHintStored");
    const presetNote = providerNote(t, preset);

    return (
        <>
            {saveError && <StatusNote tone="danger">{saveError}</StatusNote>}

            <Card>
                <h3 className="text-ink m-0 mb-3 text-[13.5px] font-semibold">
                    {t("editor.connection")}
                </h3>

                <div className="mb-4">
                    <Label htmlFor={providerId} className="text-ink-2 mb-1.5 text-xs font-semibold">
                        {t("editor.provider")}
                    </Label>
                    <Select value={provider} onValueChange={pickProvider}>
                        <SelectTrigger
                            id={providerId}
                            aria-label={t("editor.provider")}
                            className="w-full"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {MODEL_PROVIDERS.map(option => (
                                <SelectItem key={option.id} value={option.id}>
                                    {providerLabel(t, option)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {(presetNote ?? preset.keyUrl) && (
                        <div className="text-ink-3 mt-1.5 text-[12px] leading-normal">
                            {presetNote}
                            {presetNote && preset.keyUrl ? " " : ""}
                            {preset.keyUrl && (
                                <a
                                    href={preset.keyUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-brand inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
                                >
                                    {t("editor.getKey")}
                                    <ExternalLink aria-hidden className="size-3" />
                                    <span className="sr-only">{t("editor.opensNewTab")}</span>
                                </a>
                            )}
                        </div>
                    )}
                </div>

                <div className="mb-4">
                    <Label htmlFor={urlId} className="text-ink-2 mb-1.5 text-xs font-semibold">
                        {t("editor.baseUrl")}
                    </Label>
                    <Input
                        id={urlId}
                        value={baseUrl}
                        onChange={event => setBaseUrl(event.target.value)}
                        placeholder="https://api.example.com/v1"
                        inputMode="url"
                        autoComplete="off"
                        spellCheck={false}
                        className="mono placeholder:font-sans"
                    />
                    <div className="text-ink-3 mt-1 text-[11px] leading-normal">
                        {t("editor.baseUrlHint")}
                    </div>
                </div>

                <div>
                    <Label htmlFor={keyId} className="text-ink-2 mb-1.5 text-xs font-semibold">
                        {t("editor.apiKey")}
                    </Label>
                    <Input
                        id={keyId}
                        type="password"
                        value={apiKey}
                        onChange={event => setApiKey(event.target.value)}
                        placeholder={keyPlaceholder}
                        disabled={isKeyless}
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby={`${keyId}-hint`}
                    />
                    <div
                        id={`${keyId}-hint`}
                        className="text-ink-3 mt-1 text-[11px] leading-normal"
                    >
                        {keyHint}
                    </div>
                    {allowsKeyless && (
                        <div className="mt-2.5 flex items-center gap-2">
                            <Checkbox
                                id={keylessId}
                                checked={keyless}
                                onCheckedChange={checked => {
                                    setKeyless(checked === true);
                                    if (checked === true) setApiKey("");
                                }}
                            />
                            <Label
                                htmlFor={keylessId}
                                className="text-ink-2 text-[13px] font-normal"
                            >
                                {t("editor.keyless")}
                            </Label>
                        </div>
                    )}
                    {provider === "openrouter" && (
                        <div className="text-ink-3 mt-2.5 text-[12px]">
                            {t("editor.noKeyYet")}{" "}
                            <Button
                                variant="link"
                                size="sm"
                                className="h-auto p-0 text-[12px]"
                                onClick={connectOpenRouter}
                            >
                                {t("editor.connectInstead")}
                            </Button>
                        </div>
                    )}
                </div>
            </Card>

            <Card className="mt-3.5">
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <h3 className="text-ink m-0 flex-1 text-[13.5px] font-semibold">
                        {t("editor.models")}
                    </h3>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void loadModels()}
                        disabled={!trimmedUrl || listing.status === "loading"}
                    >
                        {listing.status === "loading"
                            ? tc("status.loading")
                            : t("editor.loadModels")}
                    </Button>
                </div>
                <div className="mb-4 text-[12px] leading-normal" aria-live="polite">
                    {listing.status === "done" ? (
                        <span className="text-ink-3">
                            {listing.count === 0
                                ? t("editor.listedNone")
                                : t("editor.listed", { count: listing.count })}
                        </span>
                    ) : listing.status === "failed" ? (
                        <span className="text-danger">
                            {t("editor.listFailedSuffix", { message: listing.message })}
                        </span>
                    ) : (
                        <span className="text-ink-3">{t("editor.listOptional")}</span>
                    )}
                </div>

                <datalist id={listId}>
                    {suggestions.map(id => (
                        <option key={id} value={id} />
                    ))}
                </datalist>

                <RouteFields
                    route={ROUTES[0]!}
                    structuredByDefault={preset.structuredOutputByDefault}
                    draft={drafts.default}
                    problem={problems.default}
                    listId={listId}
                    inputRef={mainRef}
                    onChange={patch => editRoute("default", patch)}
                />

                <Collapsible open={moreOpen} onOpenChange={setMoreOpen} className="mt-2">
                    <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="-ml-2 px-2">
                            <ChevronRight
                                aria-hidden
                                className={cn("transition-transform", moreOpen && "rotate-90")}
                            />
                            {t("editor.moreModels")}
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <p className="text-ink-3 m-0 mb-3 mt-1 text-[12px] leading-normal">
                            {t("editor.moreHint")}
                        </p>
                        {EXTRA_ROUTES.map(route => (
                            <RouteFields
                                key={route.id}
                                route={route}
                                structuredByDefault={preset.structuredOutputByDefault}
                                draft={drafts[route.id]}
                                problem={problems[route.id]}
                                listId={listId}
                                onChange={patch => editRoute(route.id, patch)}
                            />
                        ))}
                    </CollapsibleContent>
                </Collapsible>
            </Card>

            <Card className="mt-3.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={
                            !selection ||
                            !trimmedUrl ||
                            key.missing ||
                            hasProblem ||
                            test.state.status === "running"
                        }
                        onClick={() => {
                            if (selection) void test.run({ ...connection, models: selection });
                        }}
                    >
                        {test.state.status === "running"
                            ? t("testingShort")
                            : t("editor.testConnection")}
                    </Button>
                    <span className="text-ink-3 min-w-0 flex-1 text-[12px] leading-normal">
                        {t("editor.testHint")}
                    </span>
                </div>
                <TestOutcome state={test.state} />
                {blockers.length > 0 && (
                    <p className="text-ink-3 m-0 mt-3 text-[12px] leading-normal">
                        {t("blockers.toSave", { list: blockers.join(t("blockers.and")) })}
                    </p>
                )}
            </Card>
        </>
    );
}

function RouteFields({
    route,
    structuredByDefault,
    draft,
    problem,
    listId,
    inputRef,
    onChange,
}: {
    route: (typeof ROUTES)[number];
    /** What the checkbox shows until the admin sets it. */
    structuredByDefault: boolean;
    draft: ChoiceDraft;
    problem: string | null;
    listId: string;
    inputRef?: React.Ref<HTMLInputElement>;
    onChange: (patch: Partial<ChoiceDraft>) => void;
}) {
    const t = useTranslations("settings.workspaceModel");
    const id = useId();
    const isMain = route.id === "default";
    return (
        <div role="group" aria-labelledby={`${id}-label`} className="mb-5 last:mb-1">
            <Label
                id={`${id}-label`}
                htmlFor={`${id}-model`}
                className="text-ink-2 mb-1.5 text-xs font-semibold"
            >
                {t(`routes.${route.id}.label`)}
                {!isMain && <span className="text-ink-3 font-normal">{t("editor.optional")}</span>}
            </Label>
            <Input
                id={`${id}-model`}
                ref={inputRef}
                list={listId}
                value={draft.id}
                onChange={event => onChange({ id: event.target.value })}
                placeholder={isMain ? t("editor.modelIdPlaceholder") : t("editor.emptyUsesMain")}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={problem ? true : undefined}
                aria-describedby={`${id}-hint`}
                className="mono placeholder:font-sans"
            />
            <div
                id={`${id}-hint`}
                className={cn(
                    "mt-1 text-[11px] leading-normal",
                    problem ? "text-danger" : "text-ink-3"
                )}
            >
                {problem ?? t(`routes.${route.id}.hint`)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                <div className="flex items-center gap-2">
                    <Checkbox
                        id={`${id}-vision`}
                        checked={draft.vision}
                        onCheckedChange={checked => onChange({ vision: checked === true })}
                    />
                    <Label htmlFor={`${id}-vision`} className="text-ink-2 text-[13px] font-normal">
                        {t("editor.readsImages")}
                    </Label>
                </div>
                <div className="flex items-center gap-2">
                    <Checkbox
                        id={`${id}-reasoning`}
                        checked={draft.reasoning}
                        onCheckedChange={checked => onChange({ reasoning: checked === true })}
                    />
                    <Label
                        htmlFor={`${id}-reasoning`}
                        className="text-ink-2 text-[13px] font-normal"
                    >
                        {t("editor.reasons")}
                    </Label>
                </div>
                <div className="flex items-center gap-2">
                    <Checkbox
                        id={`${id}-structured`}
                        checked={draft.structuredOutput ?? structuredByDefault}
                        onCheckedChange={checked =>
                            onChange({ structuredOutput: checked === true })
                        }
                        aria-describedby={`${id}-structured-hint`}
                    />
                    <Label
                        htmlFor={`${id}-structured`}
                        className="text-ink-2 text-[13px] font-normal"
                    >
                        {t("editor.followsSchema")}
                    </Label>
                </div>
            </div>
            <div
                id={`${id}-structured-hint`}
                className="text-ink-3 mt-1 text-[11px] leading-normal"
            >
                {t("editor.structuredHint")}
            </div>
        </div>
    );
}
