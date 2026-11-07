"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { isModelKey } from "~/lib/ai/model-picks";

/**
 * Reads the deployment's sanitized chat route configuration.
 *
 * The client never picks a model or an endpoint — it asks what the operator
 * configured and renders honest controls: an unavailable route means the
 * matching control is disabled with a reason, and the reasoning levels here
 * are exactly the ones the server will accept. Anything the server would
 * reject should be unreachable in the UI.
 *
 * Failing closed on a fetch error is deliberate: showing an enabled Think
 * toggle we cannot back up produces a confusing 400 on send.
 *
 * It also lists the models a workspace admin offers in Ask's model menu,
 * each under the name the admin gave it and with what it can do. The
 * response never names a provider model, and neither does anything here.
 */

export type ChatRouteName = "default" | "fast" | "reasoning" | "vision";

export interface ChatVisionInfo {
    supported: boolean;
    mimeTypes?: string[];
    maxImages?: number;
}

export interface ChatReasoningInfo {
    mode: "none" | "always" | "toggle" | "effort" | "budget";
    controllable: boolean;
    efforts?: string[];
    defaultEffort?: string;
    budget?: { min: number; max: number; default: number };
}

export interface ChatRouteInfo {
    available: boolean;
    inheritsDefault?: boolean;
    vision?: ChatVisionInfo;
    reasoning?: ChatReasoningInfo;
    nativeStructuredOutput?: string[];
    unavailableReason?: string;
}

export interface ChatRoutesConfig {
    routes: Record<ChatRouteName, ChatRouteInfo>;
}

/**
 * A model the workspace offers in Ask: its key (`model:<key>` as a pick, see
 * `~/lib/ai/model-picks`), the name an admin gave it, and what it can do.
 * Mirrors `OfferedModelInfo` in `server/workspace-models/scope.ts`.
 */
export interface OfferedModelInfo extends ChatRouteInfo {
    key: string;
    label: string;
}

const NO_OFFERED_MODELS: OfferedModelInfo[] = [];

/** Keeps only well-formed entries: a key the server could have assigned and a name. */
function offeredModelsOf(value: unknown): OfferedModelInfo[] {
    if (!Array.isArray(value)) return NO_OFFERED_MODELS;
    const models = value.filter(
        (item): item is OfferedModelInfo =>
            Boolean(item) &&
            typeof item === "object" &&
            isModelKey((item as OfferedModelInfo).key) &&
            typeof (item as OfferedModelInfo).label === "string" &&
            (item as OfferedModelInfo).label.trim().length > 0
    );
    return models.length ? models : NO_OFFERED_MODELS;
}

const UNAVAILABLE: ChatRouteInfo = { available: false };

const CLOSED: ChatRoutesConfig = {
    routes: {
        default: UNAVAILABLE,
        fast: UNAVAILABLE,
        reasoning: UNAVAILABLE,
        vision: UNAVAILABLE,
    },
};

export interface ChatRoutesState {
    config: ChatRoutesConfig;
    loading: boolean;
    /**
     * True when the configuration could not be read. The routes then fail
     * closed and `offeredModels` is empty, but that says nothing about what
     * the workspace offers, so a saved pick of an offered model is kept.
     */
    failed: boolean;
    /** The models the workspace offers in Ask, in the admin's order; empty when none. */
    offeredModels: OfferedModelInfo[];
    /** True once the vision route can actually accept an image. */
    visionEnabled: boolean;
    /** True once reasoning can actually be toggled per request. */
    reasoningEnabled: boolean;
    /** Effort levels the server accepts, or undefined for non-effort models. */
    reasoningEfforts?: string[];
    /** Why a control is disabled, for the tooltip. */
    visionDisabledReason?: string;
    reasoningDisabledReason?: string;
}

export function useChatRoutes(): ChatRoutesState {
    const t = useTranslations("workspace.chatRoutes");
    const [config, setConfig] = useState<ChatRoutesConfig>(CLOSED);
    const [offeredModels, setOfferedModels] = useState<OfferedModelInfo[]>(NO_OFFERED_MODELS);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let active = true;
        void fetch("/api/config/ai-models")
            .then(async response => {
                if (!response.ok) throw new Error("Unable to load chat configuration");
                return (await response.json()) as ChatRoutesConfig & { models?: unknown };
            })
            .then(next => {
                if (!active) return;
                setConfig(next.routes ? { routes: next.routes } : CLOSED);
                setOfferedModels(next.routes ? offeredModelsOf(next.models) : NO_OFFERED_MODELS);
                setFailed(!next.routes);
                setLoading(false);
            })
            .catch(() => {
                if (!active) return;
                setConfig(CLOSED);
                setOfferedModels(NO_OFFERED_MODELS);
                setFailed(true);
                setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    const vision = config.routes.vision;
    const reasoning = config.routes.reasoning;

    return {
        config,
        loading,
        failed,
        offeredModels,
        visionEnabled: Boolean(vision?.available && vision.vision?.supported),
        reasoningEnabled: Boolean(reasoning?.available && reasoning.reasoning?.controllable),
        reasoningEfforts: reasoning?.reasoning?.efforts,
        visionDisabledReason:
            vision?.unavailableReason ??
            (vision?.available && !vision.vision?.supported ? t("noImages") : undefined),
        reasoningDisabledReason:
            reasoning?.unavailableReason ??
            (reasoning?.available && reasoning.reasoning?.mode === "always"
                ? t("alwaysReasons")
                : undefined),
    };
}
