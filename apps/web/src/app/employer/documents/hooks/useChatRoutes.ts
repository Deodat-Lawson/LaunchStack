"use client";

import { useEffect, useState } from "react";

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
  model?: string;
  inheritsDefault?: boolean;
  vision?: ChatVisionInfo;
  reasoning?: ChatReasoningInfo;
  nativeStructuredOutput?: string[];
  unavailableReason?: string;
}

export interface ChatRoutesConfig {
  routes: Record<ChatRouteName, ChatRouteInfo>;
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
  const [config, setConfig] = useState<ChatRoutesConfig>(CLOSED);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void fetch("/api/config/ai-models")
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load chat configuration");
        return (await response.json()) as ChatRoutesConfig;
      })
      .then((next) => {
        if (!active) return;
        setConfig(next.routes ? next : CLOSED);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setConfig(CLOSED);
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
    visionEnabled: Boolean(vision?.available && vision.vision?.supported),
    reasoningEnabled: Boolean(
      reasoning?.available && reasoning.reasoning?.controllable,
    ),
    reasoningEfforts: reasoning?.reasoning?.efforts,
    visionDisabledReason:
      vision?.unavailableReason ??
      (vision?.available && !vision.vision?.supported
        ? "The model serving the vision route does not accept images."
        : undefined),
    reasoningDisabledReason:
      reasoning?.unavailableReason ??
      (reasoning?.available && reasoning.reasoning?.mode === "always"
        ? "The model serving the reasoning route always reasons; there is nothing to toggle."
        : undefined),
  };
}
