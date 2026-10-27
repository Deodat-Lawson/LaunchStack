"use client";

/**
 * Workspace › Bring your own keys.
 *
 * Body only. The workspace's own provider account for chat, drafting,
 * meetings and background work (`WorkspaceModelPanel`), connected through
 * OpenRouter or an address and API key. Optional: left empty, the workspace
 * runs on the server's own credentials. Its one primary action is the model
 * editor's Save, while the editor is open.
 *
 * There was a second key here, for embeddings. It is gone from every screen;
 * a workspace that saved one keeps using it, and `/api/updateCompany` still
 * takes one.
 *
 * OpenRouter's connect flow is a top-level navigation that comes back to the
 * Workspace tab on this screen with `?openrouter=<outcome>`; the section
 * turns that into a note and takes the parameter back out of the address bar.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
    usePublishedActions,
    type SettingsSectionActions,
    type SettingsSectionProps,
} from "./contract";
import { StatusNote, type StatusTone } from "./ui";
import {
    WORKSPACE_ENDPOINT_URL,
    WorkspaceModelPanel,
    type WorkspaceEndpointView,
} from "./WorkspaceModelPanel";

// ---------------------------------------------------------------------------
// OpenRouter's return leg
// ---------------------------------------------------------------------------

type OpenRouterOutcome = "connected" | "denied" | "expired" | "unavailable" | "error";

const OPENROUTER_OUTCOMES: readonly OpenRouterOutcome[] = [
    "connected",
    "denied",
    "expired",
    "unavailable",
    "error",
];

type KeysT = ReturnType<typeof useTranslations<"settings.keys">>;

function openRouterNote(
    t: KeysT,
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
 * so a reload doesn't repeat the message.
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

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

export function KeysSection({ onActions }: SettingsSectionProps) {
    const t = useTranslations("settings.keys");
    const [endpoint, setEndpoint] = useState<WorkspaceEndpointView | null>(null);
    const [endpointLoaded, setEndpointLoaded] = useState(false);
    const [endpointError, setEndpointError] = useState<string | null>(null);

    // The model editor's Save, while it is open.
    const [editorActions, setEditorActions] = useState<SettingsSectionActions | null>(null);
    const [openRouter, setOpenRouter] = useState<OpenRouterOutcome | null>(null);

    useEffect(() => {
        const outcome = takeOpenRouterOutcome();
        if (outcome) setOpenRouter(outcome);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch(WORKSPACE_ENDPOINT_URL);
                const body = (await res.json().catch(() => ({}))) as {
                    endpoint?: WorkspaceEndpointView | null;
                    error?: string;
                };
                if (!res.ok)
                    throw new Error(
                        body.error ?? t("endpointFailedStatus", { status: res.status })
                    );
                if (!cancelled) {
                    setEndpoint(body.endpoint ?? null);
                    setEndpointError(null);
                }
            } catch (err) {
                if (!cancelled) {
                    setEndpointError(err instanceof Error ? err.message : t("endpointFailed"));
                }
            } finally {
                if (!cancelled) setEndpointLoaded(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [t]);

    const endpointChanged = useCallback((next: WorkspaceEndpointView | null) => {
        setEndpoint(next);
        // The panel says what just happened; an OpenRouter note from before
        // the change would now be describing the past.
        setOpenRouter(null);
    }, []);

    usePublishedActions(onActions, editorActions ?? {}, [editorActions]);

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
        </>
    );
}
